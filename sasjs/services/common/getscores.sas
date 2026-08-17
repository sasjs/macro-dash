/**
  @file
  @brief Return the Macro Dash leaderboard
  @details Top 10 runs by elapsed time (fastest wins), score breaks ties.
  Returns an empty table when the backend is not configured or no scores
  exist yet.

  <h4> SAS Macros </h4>
  @li sb_init.sas
  @li mf_existds.sas
**/

%sb_init()

data scores;
  length rank 8 name $12 time 8 score 8 amps 8;
  stop;
run;

%macro sb_read();
%if %length(&sb_rootdir)>0 and %mf_existds(sb.scores) %then %do;
  proc sql;
    create table scores as
    select name, time, score, amps,
      monotonic() as rank
    from sb.scores
    order by time, score desc
    ;
  quit;

  data scores;
    set scores(obs=10);
  run;
%end;
%mend sb_read;
%sb_read()

%webout(OPEN)
%webout(OBJ,scores)
%webout(CLOSE)
