"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aggregateLabel = aggregateLabel;
function aggregateLabel(docs) {
    if (docs.length === 0)
        return 'pending';
    if (docs.some((d) => d.status === 'rejected'))
        return 'resubmit_required';
    if (docs.every((d) => d.status === 'verified' || d.status === 'use_previous'))
        return 'approved';
    return 'pending';
}
//# sourceMappingURL=controlAggregate.js.map