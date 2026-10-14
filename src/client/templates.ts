import detailRowTemplate from './templates/detail-row.html';
import descriptionPlaceholderTemplate from './templates/description-placeholder.html';
import tagsPlaceholderTemplate from './templates/tags-placeholder.html';
import { renderTemplate } from './utils/template';

export function detailRowHtml(values: {
    order: string;
    title: string;
    artist: string;
    album: string;
    hapticIcons: string;
}): string {
    return renderTemplate(detailRowTemplate, values);
}

/** Glowing lines standing in for a description that is not loaded yet. */
export function descriptionPlaceholderHtml(): string {
    return renderTemplate(descriptionPlaceholderTemplate, {});
}

/** Glowing chips standing in for tags that are not loaded yet. */
export function tagsPlaceholderHtml(): string {
    return renderTemplate(tagsPlaceholderTemplate, {});
}
