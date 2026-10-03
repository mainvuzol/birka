/**
 * The build's version: the git commit the image was built from
 * (`BIRKA_RELEASE`, a build argument), or "dev". Vite writes it in at build
 * time (`define` in vite.config.ts). The crash screen shows it, and a note of
 * a broken screen carries it, so the note can be tied to the code it came
 * from.
 */
declare const __BIRKA_RELEASE__: string;
