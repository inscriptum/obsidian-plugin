/**
 * Slug for the exported page folder / file name.
 *
 * Ported verbatim from the inscriptum blog's publish pipeline
 * (blog/src/utils/common.ts) so the same note title produces the same
 * slug there and here.
 */

/** Transliterates from Russian to English (direction kept for parity with
 *  the blog's util, only rus→eng is used for slugs). */
export function transliterate(text: string, engToRus = false): string {
  const rus =
    "щ   ш  ч  ц  ю  я  ё  ж  ъ  ы  э  а б в г д е з и й к л м н о п р с т у ф х ь".split(
      / +/g,
    );
  const eng = "shh sh ch cz yu ya yo zh `` y' e` a b v g d e z i j k l m n o p r s t u f x `".split(
    / +/g,
  );

  for (let x = 0; x < rus.length; x++) {
    text = text
      .split(engToRus ? eng[x] : rus[x])
      .join(engToRus ? rus[x] : eng[x]);
    text = text
      .split(engToRus ? eng[x].toUpperCase() : rus[x].toUpperCase())
      .join(engToRus ? rus[x].toUpperCase() : eng[x].toUpperCase());
  }
  return text;
}

/** Title → slug: transliteration + everything outside [a-zA-Z0-9-_] → '-'. */
export function titleToSlug(title: string): string {
  return transliterate(title).replace(/[^a-zA-Z0-9-_]/g, "-");
}
