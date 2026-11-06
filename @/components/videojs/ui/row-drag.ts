const EDGE_SCROLL_SPEED = 8;

export interface RowDrag {
    /** The `pointerdown` on the row's handle. */
    event: PointerEvent;
    /** All rows that can swap places, in order. */
    rows: HTMLElement[];
    from: number;
    /** What scrolls while dragging near its edges; the page when left out. */
    scroller?: HTMLElement;
    /** Distance from the scroller's edges at which it starts scrolling, in pixels. */
    edge?: number;
    /** Called on release with the row's new index, which is `from` when it stayed. */
    onEnd(to: number): void;
}

/**
 * Pointer drag on a row's handle. The row follows the pointer and the rows it
 * passes slide out of its way; nothing leaves the DOM, so pointer capture holds
 * for the whole gesture and a row can travel any distance. Nothing changes order
 * until release: `onEnd` applies the move and clears the rows' transforms.
 */
export function startRowDrag({ event, rows, from, scroller, edge = 32, onEnd }: RowDrag): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const row = rows[from];
    row.dataset.dragging = '';

    const scrollTop = (): number => (scroller ? scroller.scrollTop : window.scrollY);
    const scrollBy = (delta: number): void => {
        if (scroller) scroller.scrollTop += delta;
        else window.scrollBy(0, delta);
    };
    const bounds = (): { top: number; bottom: number } => scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };

    const rects = rows.map((other) => other.getBoundingClientRect());
    const step = rects.length > 1 ? rects[1].top - rects[0].top : rects[0].height;
    const startY = event.clientY;
    const startScroll = scrollTop();
    let to = from;
    let pointerY = startY;
    let scrollTimer: ReturnType<typeof setInterval> | null = null;
    const abort = new AbortController();

    const place = (): void => {
        const offset = pointerY - startY + (scrollTop() - startScroll);
        row.style.transform = `translateY(${offset}px)`;
        const centre = rects[from].top + rects[from].height / 2 + offset;
        to = from;
        while (to < rows.length - 1 && centre > rects[to + 1].top + rects[to + 1].height / 2) to++;
        while (to > 0 && centre < rects[to - 1].top + rects[to - 1].height / 2) to--;
        rows.forEach((other, i) => {
            if (other === row) return;
            const shift = from < to && i > from && i <= to ? -step : to < from && i >= to && i < from ? step : 0;
            other.style.transform = shift ? `translateY(${shift}px)` : '';
        });
    };
    // Near the edges the list scrolls, so a row can reach entries that are out of view.
    const edgeScroll = (): void => {
        const { top, bottom } = bounds();
        const speed = pointerY < top + edge ? -EDGE_SCROLL_SPEED : pointerY > bottom - edge ? EDGE_SCROLL_SPEED : 0;
        if (speed && !scrollTimer) {
            scrollTimer = setInterval(() => {
                scrollBy(pointerY < bounds().top + edge ? -EDGE_SCROLL_SPEED : EDGE_SCROLL_SPEED);
                place();
            }, 16);
        } else if (!speed && scrollTimer) {
            clearInterval(scrollTimer);
            scrollTimer = null;
        }
    };

    handle.addEventListener('pointermove', (move) => {
        pointerY = move.clientY;
        place();
        edgeScroll();
    }, { signal: abort.signal });

    const finish = (): void => {
        abort.abort();
        if (scrollTimer) clearInterval(scrollTimer);
        delete row.dataset.dragging;
        onEnd(to);
    };
    handle.addEventListener('pointerup', finish, { signal: abort.signal });
    handle.addEventListener('pointercancel', finish, { signal: abort.signal });
}
