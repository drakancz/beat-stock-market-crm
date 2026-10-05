/**
 * Text bez diakritiky, malými písmeny — „Marešová" → „maresova".
 *
 * Pro hledání v prohlížeči (pole s výběrem). V databázi totéž dělá
 * `unaccent(lower())`, viz `src/lib/hledani.ts` (Jakub, 25. 9. 2026).
 */
export function bezDiakritiky(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
