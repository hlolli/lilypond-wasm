#include <libguile.h>

#include <stdio.h>

static void *
run_scheme (void *data)
{
  (void) data;

  SCM value = scm_c_eval_string (
    "(begin "
    "  (use-modules (ice-9 match) (srfi srfi-1)) "
    "  (match (iota 4) ((a b c d) (+ a b c d))))");

  printf ("guile result: %ld\n", (long) scm_to_long (value));
  return NULL;
}

int
main (void)
{
  scm_with_guile (run_scheme, NULL);
  return 0;
}
