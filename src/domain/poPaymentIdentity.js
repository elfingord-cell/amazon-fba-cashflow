const PO_AUTO_EVENT_TYPES = Object.freeze(["freight", "duty", "eust", "vat_refund", "fx_fee"]);

const AUTO_EVENT_ID_ALIASES = Object.freeze({
  freight: ["freight"],
  duty: ["duty"],
  eust: ["eust"],
  vat_refund: ["vat_refund", "vat", "vat-refund", "eust_refund", "eust-refund"],
  fx_fee: ["fx_fee", "fx", "fx-fee"],
});

function cloneValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function sanitizeOwnerKey(value) {
  const raw = normalizeText(value);
  if (!raw) return "po";
  const sanitized = raw
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "po";
}

function mergeFilledObject(currentRaw, incomingRaw) {
  const current = currentRaw && typeof currentRaw === "object" ? { ...currentRaw } : {};
  const incoming = incomingRaw && typeof incomingRaw === "object" ? incomingRaw : null;
  if (!incoming) return Object.keys(current).length ? current : incomingRaw;

  Object.entries(incoming).forEach(([key, value]) => {
    if (value == null || value === "") {
      if (!(key in current)) current[key] = value;
      return;
    }
    if (typeof value === "boolean") {
      if (!(key in current) || value === true) current[key] = value;
      return;
    }
    current[key] = value;
  });

  return current;
}

function isPaidLikeValue(value) {
  if (value === true || value === 1) return true;
  const raw = normalizeText(value).toLowerCase();
  return raw === "paid"
    || raw === "bezahlt"
    || raw === "done"
    || raw === "true"
    || raw === "1"
    || raw === "yes"
    || raw === "ja";
}

function buildClaimKey(paymentId, legacyEventId) {
  return `${paymentId}::${legacyEventId}`;
}

function sameStringArray(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (String(left[index] || "") !== String(right[index] || "")) return false;
  }
  return true;
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => normalizeText(value)).filter(Boolean)));
}

function getTypeAliases(type) {
  return AUTO_EVENT_ID_ALIASES[type] || [];
}

function getAutoEventOwnerKey(record) {
  return sanitizeOwnerKey(record?.id || record?.poNo || "po");
}

function createBackfillReport() {
  return {
    posRecordsChanged: 0,
    autoEventIdsRewritten: 0,
    paymentLogKeysRewritten: 0,
    paymentTransactionEventIdsRewritten: 0,
    paymentCoveredEventIdsRewritten: 0,
    paymentCoveredEventIdsRemoved: 0,
    paymentAllocationEventIdsRewritten: 0,
    paymentAllocationPlannedIdsRewritten: 0,
    conflicts: [],
  };
}

function reportHasChanges(report) {
  if (!report || typeof report !== "object") return false;
  return Number(report.posRecordsChanged || 0) > 0
    || Number(report.autoEventIdsRewritten || 0) > 0
    || Number(report.paymentLogKeysRewritten || 0) > 0
    || Number(report.paymentTransactionEventIdsRewritten || 0) > 0
    || Number(report.paymentCoveredEventIdsRewritten || 0) > 0
    || Number(report.paymentCoveredEventIdsRemoved || 0) > 0
    || Number(report.paymentAllocationEventIdsRewritten || 0) > 0
    || Number(report.paymentAllocationPlannedIdsRewritten || 0) > 0;
}

function mergeReports(target, incoming) {
  if (!incoming) return target;
  target.posRecordsChanged += Number(incoming.posRecordsChanged || 0);
  target.autoEventIdsRewritten += Number(incoming.autoEventIdsRewritten || 0);
  target.paymentLogKeysRewritten += Number(incoming.paymentLogKeysRewritten || 0);
  target.paymentTransactionEventIdsRewritten += Number(incoming.paymentTransactionEventIdsRewritten || 0);
  target.paymentCoveredEventIdsRewritten += Number(incoming.paymentCoveredEventIdsRewritten || 0);
  target.paymentCoveredEventIdsRemoved += Number(incoming.paymentCoveredEventIdsRemoved || 0);
  target.paymentAllocationEventIdsRewritten += Number(incoming.paymentAllocationEventIdsRewritten || 0);
  target.paymentAllocationPlannedIdsRewritten += Number(incoming.paymentAllocationPlannedIdsRewritten || 0);
  if (Array.isArray(incoming.conflicts) && incoming.conflicts.length) {
    const seen = new Set(target.conflicts.map((entry) => `${entry.paymentId}:${entry.legacyEventId}`));
    incoming.conflicts.forEach((entry) => {
      const key = `${entry.paymentId}:${entry.legacyEventId}`;
      if (seen.has(key)) return;
      seen.add(key);
      target.conflicts.push(entry);
    });
  }
  return target;
}

function recordConflict(report, claim) {
  if (!claim || !claim.paymentId || !claim.legacyEventId) return;
  const key = `${claim.paymentId}:${claim.legacyEventId}`;
  const seen = new Set((report.conflicts || []).map((entry) => `${entry.paymentId}:${entry.legacyEventId}`));
  if (seen.has(key)) return;
  report.conflicts.push({
    paymentId: claim.paymentId,
    legacyEventId: claim.legacyEventId,
    canonicalEventIds: Array.from(claim.canonicalEventIds).sort(),
    poRefs: Array.from(claim.poRefs).sort(),
  });
}

function addExplicitClaim(claims, paymentId, legacyEventId, canonicalEventId, poRef) {
  const key = buildClaimKey(paymentId, legacyEventId);
  if (!claims.has(key)) {
    claims.set(key, {
      paymentId,
      legacyEventId,
      canonicalEventIds: new Set(),
      poRefs: new Set(),
    });
  }
  const claim = claims.get(key);
  claim.canonicalEventIds.add(canonicalEventId);
  claim.poRefs.add(poRef);
  return claim;
}

function resolveExplicitClaim(claims, paymentId, legacyEventId) {
  const key = buildClaimKey(paymentId, legacyEventId);
  const claim = claims.get(key);
  if (!claim) return null;
  if (claim.canonicalEventIds.size !== 1 || claim.poRefs.size !== 1) {
    return { type: "conflict", claim };
  }
  return {
    type: "claimed",
    claim,
    canonicalEventId: Array.from(claim.canonicalEventIds)[0],
  };
}

export function normalizePoAutoEventType(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (PO_AUTO_EVENT_TYPES.includes(raw)) return raw;
  const normalized = raw.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  for (const type of PO_AUTO_EVENT_TYPES) {
    if (getTypeAliases(type).map((entry) => entry.toLowerCase().replace(/-/g, "_")).includes(normalized)) {
      return type;
    }
  }
  return "";
}

export function inferPoAutoEventTypeFromId(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  for (const type of PO_AUTO_EVENT_TYPES) {
    const aliases = getTypeAliases(type);
    for (const alias of aliases) {
      if (raw === `auto-${alias}`) return type;
      if (raw.endsWith(`-auto-${alias}`)) return type;
      if (raw.startsWith("po-auto-") && raw.endsWith(`-${alias}`)) return type;
    }
  }
  return "";
}

export function getCanonicalPoAutoEventId(record, type) {
  const normalizedType = normalizePoAutoEventType(type);
  if (!normalizedType) return "";
  const ownerKey = getAutoEventOwnerKey(record);
  return `po-auto-${ownerKey}-${normalizedType}`;
}

export function isCanonicalPoAutoEventId(record, eventId, type = "") {
  const normalizedType = normalizePoAutoEventType(type) || inferPoAutoEventTypeFromId(eventId);
  if (!normalizedType) return false;
  return normalizeText(eventId) === getCanonicalPoAutoEventId(record, normalizedType);
}

export function hasExplicitPoPaymentEvidence(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  if (isPaidLikeValue(source.status) || isPaidLikeValue(source.paid)) return true;
  if (normalizeText(source.paidDate)) return true;
  if (normalizeText(source.paymentId)) return true;

  const amountCandidates = [source.amountActualEur, source.amountActualUsd];
  return amountCandidates.some((candidate) => candidate != null && candidate !== "" && Number.isFinite(Number(candidate)));
}

export function normalizePoPaymentStateRecord(input, options = {}) {
  const mutate = options?.mutate === true;
  const record = mutate ? (input || {}) : cloneValue(input || {});
  const report = createBackfillReport();
  const aliasMap = new Map();
  const canonicalIdsByType = new Map();

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { record, changed: false, aliasMap, canonicalIdsByType, report };
  }

  PO_AUTO_EVENT_TYPES.forEach((type) => {
    const canonicalId = getCanonicalPoAutoEventId(record, type);
    canonicalIdsByType.set(type, canonicalId);
    const ownerKey = getAutoEventOwnerKey(record);
    getTypeAliases(type).forEach((alias) => {
      const genericId = `auto-${alias}`;
      const ownerScopedId = `po-auto-${ownerKey}-${alias}`;
      if (genericId !== canonicalId) aliasMap.set(genericId, canonicalId);
      if (ownerScopedId !== canonicalId) aliasMap.set(ownerScopedId, canonicalId);
    });
  });

  if (Array.isArray(record.autoEvents)) {
    record.autoEvents.forEach((event) => {
      const type = normalizePoAutoEventType(event?.type);
      if (!type) return;
      const canonicalId = canonicalIdsByType.get(type);
      const currentId = normalizeText(event?.id);
      if (currentId && currentId !== canonicalId) {
        aliasMap.set(currentId, canonicalId);
        report.autoEventIdsRewritten += 1;
      }
      event.id = canonicalId;
    });
  }

  const paymentLog = record.paymentLog && typeof record.paymentLog === "object" ? record.paymentLog : {};
  const nextPaymentLog = {};
  Object.entries(paymentLog).forEach(([eventIdRaw, entryRaw]) => {
    const eventId = normalizeText(eventIdRaw);
    const normalizedEventId = aliasMap.get(eventId) || canonicalIdsByType.get(inferPoAutoEventTypeFromId(eventId)) || eventId;
    if (normalizedEventId && normalizedEventId !== eventId) {
      report.paymentLogKeysRewritten += 1;
    }
    nextPaymentLog[normalizedEventId || eventId] = mergeFilledObject(nextPaymentLog[normalizedEventId || eventId], entryRaw);
  });
  if (Object.keys(nextPaymentLog).length || record.paymentLog) {
    record.paymentLog = nextPaymentLog;
  }

  if (Array.isArray(record.paymentTransactions)) {
    record.paymentTransactions = record.paymentTransactions.map((entryRaw) => {
      const entry = entryRaw && typeof entryRaw === "object" ? { ...entryRaw } : entryRaw;
      if (!entry || !Array.isArray(entry.eventIds)) return entry;
      const nextEventIds = uniqueStrings(entry.eventIds.map((eventIdRaw) => {
        const eventId = normalizeText(eventIdRaw);
        const normalizedEventId = aliasMap.get(eventId) || canonicalIdsByType.get(inferPoAutoEventTypeFromId(eventId)) || eventId;
        if (normalizedEventId && normalizedEventId !== eventId) {
          report.paymentTransactionEventIdsRewritten += 1;
        }
        return normalizedEventId;
      }));
      entry.eventIds = nextEventIds;
      return entry;
    });
  }

  const changed = reportHasChanges(report);
  if (changed) report.posRecordsChanged += 1;
  return { record, changed, aliasMap, canonicalIdsByType, report };
}

export function backfillPoPaymentState(input, options = {}) {
  const mutate = options?.mutate === true;
  const state = mutate ? (input || {}) : cloneValue(input || {});
  const report = createBackfillReport();
  const explicitClaims = new Map();

  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { state, changed: false, report };
  }

  if (Array.isArray(state.pos)) {
    state.pos = state.pos.map((entryRaw) => {
      const result = normalizePoPaymentStateRecord(entryRaw, { mutate: true });
      mergeReports(report, result.report);

      const paymentLog = result.record?.paymentLog && typeof result.record.paymentLog === "object"
        ? result.record.paymentLog
        : {};
      const poRef = normalizeText(result.record?.id || result.record?.poNo || "po");
      Object.entries(paymentLog).forEach(([eventId, logEntryRaw]) => {
        const logEntry = logEntryRaw && typeof logEntryRaw === "object" ? logEntryRaw : {};
        const paymentId = normalizeText(logEntry.paymentId);
        if (!paymentId) return;
        result.aliasMap.forEach((canonicalEventId, legacyEventId) => {
          if (canonicalEventId !== eventId || legacyEventId === eventId) return;
          addExplicitClaim(explicitClaims, paymentId, legacyEventId, canonicalEventId, poRef);
        });
      });
      return result.record;
    });
  }

  if (Array.isArray(state.payments)) {
    state.payments = state.payments.map((entryRaw) => {
      const payment = entryRaw && typeof entryRaw === "object" ? { ...entryRaw } : entryRaw;
      if (!payment) return payment;
      const paymentId = normalizeText(payment.id);

      if (Array.isArray(payment.coveredEventIds)) {
        const nextCoveredEventIds = [];
        payment.coveredEventIds.forEach((eventIdRaw) => {
          const eventId = normalizeText(eventIdRaw);
          if (!eventId) return;
          const autoType = inferPoAutoEventTypeFromId(eventId);
          if (!autoType || eventId.startsWith("po-auto-")) {
            nextCoveredEventIds.push(eventId);
            return;
          }
          const resolution = paymentId ? resolveExplicitClaim(explicitClaims, paymentId, eventId) : null;
          if (resolution?.type === "claimed") {
            if (resolution.canonicalEventId !== eventId) {
              report.paymentCoveredEventIdsRewritten += 1;
            }
            nextCoveredEventIds.push(resolution.canonicalEventId);
            return;
          }
          report.paymentCoveredEventIdsRemoved += 1;
          if (resolution?.type === "conflict") recordConflict(report, resolution.claim);
        });
        const uniqueCoveredEventIds = uniqueStrings(nextCoveredEventIds);
        if (!sameStringArray(uniqueCoveredEventIds, payment.coveredEventIds)) {
          payment.coveredEventIds = uniqueCoveredEventIds;
        }
      }

      if (Array.isArray(payment.allocations)) {
        payment.allocations = payment.allocations.map((allocationRaw) => {
          const allocation = allocationRaw && typeof allocationRaw === "object" ? { ...allocationRaw } : allocationRaw;
          if (!allocation) return allocation;
          ["eventId", "plannedId"].forEach((field) => {
            const currentId = normalizeText(allocation[field]);
            if (!currentId) return;
            const autoType = inferPoAutoEventTypeFromId(currentId);
            if (!autoType || currentId.startsWith("po-auto-")) return;
            const resolution = paymentId ? resolveExplicitClaim(explicitClaims, paymentId, currentId) : null;
            if (resolution?.type !== "claimed") {
              if (resolution?.type === "conflict") recordConflict(report, resolution.claim);
              return;
            }
            if (resolution.canonicalEventId === currentId) return;
            allocation[field] = resolution.canonicalEventId;
            if (field === "eventId") report.paymentAllocationEventIdsRewritten += 1;
            if (field === "plannedId") report.paymentAllocationPlannedIdsRewritten += 1;
          });
          return allocation;
        });
      }

      return payment;
    });
  }

  return {
    state,
    changed: reportHasChanges(report),
    report,
  };
}
