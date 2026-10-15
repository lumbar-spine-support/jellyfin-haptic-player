/**
 * Covers glow with Bootstrap's placeholder (`placeholder` on the image inside a `placeholder-glow`)
 * until they load. Templates add the class to images they create; one capture listener on the
 * document removes it from any image that loads or fails, so no image needs its own handler.
 */

/** Clears the placeholder of every image under `root` once it loads or fails. Call once at startup. */
export function settleImagePlaceholders(root: Document = document): void {
  const settle = (event: Event): void => {
    if (event.target instanceof HTMLImageElement) event.target.classList.remove('placeholder');
  };
  root.addEventListener('load', settle, true);
  root.addEventListener('error', settle, true);
}

/**
 * Lets an existing image glow while the source just assigned to it loads. An image that already
 * shows that source fires no `load`, so it is left alone.
 */
export function markImageLoading(img: HTMLImageElement): void {
  img.classList.toggle('placeholder', !img.complete);
}
