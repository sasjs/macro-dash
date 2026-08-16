/**
  @file
  @brief Macro Dash global settings
  @details Fetched by the sb_init() macro (via %mx_getcode, so it works on
  Viya, SAS 9 and SASjs Server).  It will NOT be fetched if the `sb_rootdir`
  macro variable already contains a value (eg set in the autoexec).

  The first installer can either edit this file before deployment, or use the
  in-game configuration screen (press C on the title screen) which rewrites
  this job with the chosen folder.

  sb_rootdir : filesystem directory for the results dataset
  (scores.sas7bdat).  Leave EMPTY to run in "unconfigured" mode
  (scores stay in the browser's localStorage only).
**/

/* filesystem directory to contain the Macro Dash results dataset */
%let sb_rootdir=;
