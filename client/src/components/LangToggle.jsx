import React, { useEffect, useState } from "react";
import { getLang, setLang } from "../i18n.js";

/** English / Arabic switch. Shows the language you switch TO. */
export default function LangToggle({ className = "" }) {
  const [lang, set] = useState(getLang);
  useEffect(() => {
    const h = () => set(getLang());
    window.addEventListener("lang:changed", h);
    return () => window.removeEventListener("lang:changed", h);
  }, []);
  const next = lang === "ar" ? "en" : "ar";
  return (
    <button
      type="button"
      id="btn-lang"
      data-no-i18n
      className={`btn btn-sm btn-ghost icon-btn lang-btn ${className}`}
      onClick={() => setLang(next)}
      title={next === "ar" ? "التبديل إلى العربية" : "Switch to English"}
      aria-label={next === "ar" ? "التبديل إلى العربية" : "Switch to English"}
      lang={next}
    >
      {next === "ar" ? "ع" : "EN"}
    </button>
  );
}
