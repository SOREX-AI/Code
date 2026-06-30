export type StyledCssValue = string | number | boolean | null | undefined;

export function css(strings: TemplateStringsArray, ...values: StyledCssValue[]): string {
  return strings.reduce((result, chunk, index) => {
    const value = values[index];
    return result + chunk + (value === null || value === undefined || value === false ? '' : String(value));
  }, '');
}

export function joinStyles(...styles: string[]): string {
  return styles.filter(Boolean).join('\n');
}
