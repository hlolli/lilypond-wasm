\version "2.27.2"

% Load the SVG modules explicitly, then run a small score through the full
% parse, layout, page-breaking, font, and SVG output path.
#(use-modules
  (lily framework-svg)
  (lily output-svg)
  (lily page))

\header {
  title = "LilyPond WASI bytecode"
  tagline = ##f
}

\score {
  \new Staff <<
    \new Voice = "melody" {
      c'4 d' e' f'
    }
    \new Lyrics \lyricsto "melody" {
      Com -- piled Scheme works.
    }
  >>
}
