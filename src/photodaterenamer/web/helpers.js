/* Pure helpers shared by the interface and its Node tests. No DOM access here. */
(function (root, factory) {
  const helpers = factory();
  if (typeof module === "object" && module.exports) module.exports = helpers;
  else root.PDRHelpers = helpers;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* A leading calendar date such as 2024_05_06, 2024-05-06 or 20240506. */
  const LEADING_DATE = /^(?:1[89]|2\d)\d{2}([_-]?)(0[1-9]|1[0-2])\1(0[1-9]|[12]\d|3[01])(?!\d)/;

  function baseName(path) {
    const slash = path.lastIndexOf("/");
    return slash === -1 ? path : path.slice(slash + 1);
  }

  /** True when a file name already starts with a date, e.g. a photo renamed before. */
  function looksDated(path) {
    return LEADING_DATE.test(baseName(path));
  }

  /**
   * Shorten text to at most `max` characters by removing its middle, so both the date at
   * the start and the extension at the end of a file name stay visible.
   */
  function middleEllipsis(text, max) {
    if (max < 5 || text.length <= max) return text;
    const keepEnd = Math.max(6, Math.floor((max - 1) * 0.4));
    const keepStart = max - 1 - keepEnd;
    return `${text.slice(0, keepStart)}…${text.slice(text.length - keepEnd)}`;
  }

  /** Digits for a seven-segment readout: Spanish grouping uses "." (DSEG draws it as a dot). */
  function segmentDigits(value) {
    return String(Math.max(0, Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  /** The unlit "8" cells behind a seven-segment readout, matching its width. */
  function segmentGhost(text) {
    return text.replace(/\d/g, "8");
  }

  /** Compact date stamp "'24 08 14" from 20240814, 2024_08_14 or 2024-08-14. */
  function stampFromDateText(dateText) {
    const digits = String(dateText || "").replace(/\D/g, "");
    if (digits.length !== 8) return "";
    return `'${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)}`;
  }

  return { looksDated, middleEllipsis, segmentDigits, segmentGhost, stampFromDateText, baseName };
});
