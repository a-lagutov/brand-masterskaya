/** A relationship value: an id or, when populated, the related document. */
type Relation = number | string | { id: number | string } | null | undefined;

/**
 * Ids of a relationship field, whether Payload returned ids or populated documents.
 * @param value A hasMany relationship value.
 * @returns The related ids as numbers.
 */
export function relationIds(value: Relation[] | Relation | null | undefined): number[] {
  const relations = Array.isArray(value) ? value : value == null ? [] : [value];
  return relations
    .map((relation) => (typeof relation === 'object' && relation !== null ? relation.id : relation))
    .filter((id): id is number | string => id != null)
    .map(Number);
}
