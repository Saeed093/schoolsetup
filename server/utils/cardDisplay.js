/**
 * Guardians JSON and legacy adult_* display helpers for cards and scan broadcasts.
 */

function safeParseGuardiansJson(str) {
  if (!str || typeof str !== 'string') return [];
  try {
    const arr = JSON.parse(str);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function displayRelation(g) {
  if (!g || typeof g !== 'object') return 'Guardian';
  if (g.relation === 'other' && (g.relationOther || '').trim()) {
    return String(g.relationOther).trim();
  }
  const map = { father: 'Father', mother: 'Mother', driver: 'Driver', other: 'Other' };
  return map[g.relation] || 'Guardian';
}

function guardianDisplayName(g) {
  if (!g || typeof g !== 'object') return '';
  const n = (g.name || '').trim();
  const rel = displayRelation(g);
  if (n) return `${n} (${rel})`;
  return rel;
}

/**
 * Full guardian list for a DB row: parsed JSON or one synthetic entry from legacy adult_*.
 */
function getGuardiansForRow(row) {
  if (!row) return [];
  const parsed = safeParseGuardiansJson(row.guardians_json);
  if (parsed.length > 0) return parsed;
  const img = row.adult_image ?? '';
  const name = row.adult_name ?? '';
  if (!name && !img) return [];
  return [
    {
      name,
      relation: 'other',
      relationOther: '',
      image: img,
      descriptor: null
    }
  ];
}

/**
 * Set adult_name / adult_image from first guardian (for DB columns used by older code paths).
 */
function syncAdultFromGuardians(guardians) {
  if (!guardians || !guardians.length) {
    return { adult_name: '', adult_image: '' };
  }
  const g0 = guardians[0];
  return {
    adult_name: guardianDisplayName(g0),
    adult_image: (g0.image || '').split('?')[0]
  };
}

/**
 * Subset for WebSocket/API scan payloads (descriptors only; no image URLs in this list).
 */
function guardiansCompactForScan(guardians) {
  if (!guardians || !guardians.length) return [];
  return guardians
    .filter((g) => Array.isArray(g.descriptor) && g.descriptor.length === 128)
    .map((g) => ({
      name: (g.name || '').trim(),
      relation: g.relation || 'other',
      relationOther: (g.relationOther || '').trim(),
      label: guardianDisplayName(g),
      descriptor: g.descriptor,
      image: (g.image || '').split('?')[0]
    }));
}

module.exports = {
  safeParseGuardiansJson,
  displayRelation,
  guardianDisplayName,
  getGuardiansForRow,
  syncAdultFromGuardians,
  guardiansCompactForScan
};
