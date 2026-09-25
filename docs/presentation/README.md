# Person A slides

`person_a_slides.tex` contains five shared-deck slides. Slide 3 has one overlay, so its PDF has six pages.

## Use in Prism

1. Upload `person_a_slides.tex` as `main.tex`.
2. Upload the `images` folder with its three PNG files: `capture.png`, `spectrum.png`, and `peaks.png`. Keep the folder name `images`.
3. Select **pdfLaTeX** or **XeLaTeX** and compile. No extra fonts are needed.
4. Replace `\TeamNames` in the source with your actual names.

The screenshots come from Apollo's own explanation view. The spectrum and peaks screenshots are cropped by `\includegraphics` so their explanatory side panels are absent from the slides. Keep the original PNG files alongside the TeX source; the crops are defined in the source.

Speaking cues and timing are in `person_a_speech.md`.
