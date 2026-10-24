import { qs } from '../../utils/html';
import { storedSetting } from '../../utils/storedSetting';

/** A settings checkbox persisted in localStorage; `apply` runs for the initial value and every change. */
export function bindToggle(selector: string, storageKey: string, fallback: boolean, apply: (enabled: boolean) => void): void {
  const toggle = qs<HTMLInputElement>(selector);
  const setting = storedSetting(storageKey, fallback);
  const enabled = setting.get();
  apply(enabled);
  if (!toggle) return;
  toggle.checked = enabled;
  toggle.addEventListener('change', () => {
    setting.set(toggle.checked);
    apply(toggle.checked);
  });
}

/** A settings dropdown persisted in localStorage; stored values `isValid` rejects fall back. */
export function bindSelect<T extends string>(
  selector: string,
  storageKey: string,
  fallback: T,
  isValid: (value: string) => value is T,
  apply: (value: T) => void,
): void {
  const select = qs<HTMLSelectElement>(selector);
  const setting = storedSetting<string>(storageKey, fallback);
  const stored = setting.get();
  const value = isValid(stored) ? stored : fallback;
  apply(value);
  if (!select) return;
  select.value = value;
  select.addEventListener('change', () => {
    if (!isValid(select.value)) return;
    setting.set(select.value);
    apply(select.value);
  });
}
