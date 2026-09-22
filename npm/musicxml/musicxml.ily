% SPDX-License-Identifier: GPL-3.0-or-later
% Export the resolved score, before the engraving pass changes its music.
\version "2.24.3"
#(if (not (defined? 'wmx:export-book))
     (primitive-load (ly:find-file "musicxml.scm")))
#(if (not (defined? 'wmx:installed))
     (let* ((previous (if (defined? 'default-toplevel-book-handler)
                         default-toplevel-book-handler toplevel-book-handler))
            (handler (lambda (book)
                       (wmx:export-book book)
                       (unless (eq? (ly:parser-lookup 'wmx:only) #t)
                         (previous book)))))
       (ly:parser-define! 'wmx:installed #t)
       (ly:parser-define! 'wmx:score-index 0)
       (ly:parser-define! 'toplevel-book-handler handler)
       (ly:parser-define! 'default-toplevel-book-handler handler)))
