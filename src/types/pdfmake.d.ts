declare module "pdfmake" {
  const pdfmake: {
    addFonts(fonts: Record<string, Record<string, string>>): void;
    setUrlAccessPolicy(policy: (url: string) => boolean): void;
    setLocalAccessPolicy(policy: (path: string) => boolean): void;
    createPdf(definition: { content: { text: string }[]; defaultStyle: { font: string; fontSize: number } }): { getBuffer(): Promise<Buffer> };
  };
  export default pdfmake;
}
declare module "pdfmake/fonts/Roboto.js" {
  const fonts: Record<string, Record<string, string>>;
  export default fonts;
}
