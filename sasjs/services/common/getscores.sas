/**
  @file
  @brief Return the Macro Dash leaderboard
  @details Top 10 runs.  Finishers (done=1) rank by elapsed time (fastest
  wins, score breaks ties); DNFs (done=0) follow, most-recent first.  An
  empty table is returned when the backend is not configured or no scores
  exist yet.

  <h4> SAS Macros </h4>
  @li md_init.sas
  @li mf_existds.sas
**/

%md_init()

data scores;
  length rank 8 name $12 time 8 score 8 amps 8 done 8;
  stop;
run;

%macro md_read();
%if %length(&md_rootdir)>0 and %mf_existds(sb.scores) %then %do;
  proc sql;
    create table scores as
    select name, time, score, amps, done,
      monotonic() as rank
    from sb.scores
    order by done desc, time, score desc, submitted desc
    ;
  quit;

  data scores;
    set scores(obs=10);
  run;
%end;
%mend md_read;
%md_read()

%webout(OPEN)
%webout(OBJ,scores)
%webout(CLOSE)
