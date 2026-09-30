// Presence of this context = embedded: the host owns the theme, so TopBar hides its picker.
export interface EmbedContext {
  embedded: true;
}

export const EMBED_KEY = Symbol("ghreview:embed");
