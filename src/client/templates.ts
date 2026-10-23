import descriptionPlaceholderTemplate from './templates/description-placeholder.html';
import tagsPlaceholderTemplate from './templates/tags-placeholder.html';
import { renderTemplate } from './utils/template';

/** Glowing lines standing in for a description that is not loaded yet. */
export function descriptionPlaceholderHtml(): string {
    return renderTemplate(descriptionPlaceholderTemplate, {});
}

/** Glowing chips standing in for tags that are not loaded yet. */
export function tagsPlaceholderHtml(): string {
    return renderTemplate(tagsPlaceholderTemplate, {});
}
