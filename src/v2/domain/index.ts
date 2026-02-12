// V2 keeps business logic parity by reusing proven domain calculators from V1.
export {
  computeSeries,
  computeOutflowStack,
  expandFixcostInstances,
} from "../../domain/cashflow.js";
export { computeInventoryProjection } from "../../domain/inventoryProjection.js";
export { computeVatPreview } from "../../domain/vatPreview.js";
export { computeFoSuggestion } from "../../domain/foSuggestion.js";
export { computeAbcClassification } from "../../domain/abcClassification.js";
