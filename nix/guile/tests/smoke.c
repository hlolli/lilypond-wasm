#include <libguile.h>

#include <stdio.h>

static void *
run_scheme (void *data)
{
  (void) data;

  SCM value = scm_c_eval_string (
    "(begin "
    "  (use-modules (ice-9 match) (oop goops) (srfi srfi-1)) "
    "  (match (iota 4) ((a b c d) (+ a b c d))))");
  SCM target_word_size = scm_c_eval_string (
    "(begin "
    "  (use-modules (system base target)) "
    "  (target-word-size))");

  printf ("guile result: %ld\n", (long) scm_to_long (value));
  printf ("guile target word size: %ld\n",
          (long) scm_to_long (target_word_size));
  return NULL;
}

int
main (void)
{
  scm_with_guile (run_scheme, NULL);
  return 0;
}
