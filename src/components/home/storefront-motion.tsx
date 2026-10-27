"use client";

import { useEffect } from "react";

// The HTML remains visible without JavaScript. Entrances enhance only content below the fold.
export function StorefrontMotion() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches || !("IntersectionObserver" in window)) return;
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.setAttribute("data-visible", "true");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -24px 0px" },
    );
    elements.forEach((element) => {
      if (element.getBoundingClientRect().top > window.innerHeight - 24) {
        element.setAttribute("data-motion", "ready");
        observer.observe(element);
      }
    });
    const revealAll = () => {
      if (media.matches)
        elements.forEach((element) => element.setAttribute("data-visible", "true"));
    };
    media.addEventListener("change", revealAll);
    return () => {
      observer.disconnect();
      elements.forEach((element) => element.removeAttribute("data-motion"));
      media.removeEventListener("change", revealAll);
    };
  }, []);
  return null;
}
