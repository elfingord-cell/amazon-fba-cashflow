"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.daysBetween = exports.addDays = exports.parseISODate = void 0;
exports.overlapDays = overlapDays;
const dates_js_1 = require("../domain/shared/dates.js");
var dates_js_2 = require("../domain/shared/dates.js");
Object.defineProperty(exports, "parseISODate", { enumerable: true, get: function () { return dates_js_2.parseISODate; } });
Object.defineProperty(exports, "addDays", { enumerable: true, get: function () { return dates_js_2.addDays; } });
Object.defineProperty(exports, "daysBetween", { enumerable: true, get: function () { return dates_js_2.daysBetween; } });
function overlapDays(startA, endA, startB, endB) {
    if (!(startA instanceof Date) || !(endA instanceof Date))
        return 0;
    if (!(startB instanceof Date) || !(endB instanceof Date))
        return 0;
    if (Number.isNaN(startA.getTime()) || Number.isNaN(endA.getTime()))
        return 0;
    if (Number.isNaN(startB.getTime()) || Number.isNaN(endB.getTime()))
        return 0;
    const start = startA > startB ? startA : startB;
    const end = endA < endB ? endA : endB;
    if (end < start)
        return 0;
    const delta = (0, dates_js_1.daysBetween)(start, end);
    return delta == null ? 0 : delta + 1;
}
