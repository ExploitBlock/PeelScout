const src = document.getElementById("src");
const out = document.getElementById("out");
const meta = document.getElementById("meta");
function run() {
  const href = src.value.trim();
  if (!href) { out.textContent = "\u2014"; return; }
  const r = WrapperUnwrap.unwrapOnce(href);
  if (r.changed) {
    meta.textContent = "Removed: " + r.vendor;
    out.textContent = r.url;
  } else if (r.vendor) {
    meta.textContent = r.vendor + (r.note ? " \u2014 " + r.note : "");
    out.textContent = r.url;
  } else {
    meta.textContent = "No known security wrapper.";
    out.textContent = href;
  }
}
document.getElementById("go").addEventListener("click", run);
src.addEventListener("input", run);
document.getElementById("copy").addEventListener("click", async () => {
  const t = out.textContent;
  if (t && t !== "\u2014") await navigator.clipboard.writeText(t);
});
