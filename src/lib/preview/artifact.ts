/** Keep the first line identical in validation and execution for diagnostic offsets. */
export function buildAppScript(js: string): string {
  return '(async function __ma_main(appStore){ "use strict";\n' + js
    + '\n})(window.appStore).then(window.__ma_runtime.done, window.__ma_runtime.fail);\n//# sourceURL=miniatoms-app.js';
}

export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
