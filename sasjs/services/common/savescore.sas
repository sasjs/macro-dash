/**
  @file
  @brief Record a Macro Dash run
  @details Appends the run to sb.scores and returns the refreshed top 10
  plus the rank of the submitted run.

  Input: work.savescore (dataset) - one row with columns:
    name  - player initials (max 12 chars, upcased)
    time  - elapsed seconds (numeric)
    score - macro-resolution score (numeric)
    amps  - ampersands collected (numeric)

  <h4> SAS Macros </h4>
  @li md_init.sas
  @li mf_existds.sas
  @li mp_abort.sas
**/

%md_init()

%mp_abort(iftrue= (%length(&md_rootdir)=0)
  ,mac=&_program
  ,msg=%str(Macro Dash is not configured - no results folder)
)

%mp_abort(iftrue= (%mf_existds(work.savescore)=0)
  ,mac=&_program
  ,msg=%str(No savescore input table provided)
)

data newscore;
  length name $12 time 8 score 8 amps 8 submitted 8;
  set work.savescore(rename=(time=tm score=sc amps=am));
  name=upcase(substr(name,1,12));
  time=tm;
  score=sc;
  amps=am;
  submitted=datetime();
  keep name time score amps submitted;
run;

data _null_;
  set newscore;
  call symputx('md_time',time);
  call symputx('md_score',score);
run;

%macro md_append();
%if %mf_existds(sb.scores) %then %do;
  proc append base=sb.scores data=newscore;
  run;
%end;
%else %do;
  data sb.scores;
    set newscore;
  run;
%end;
%mend md_append;
%md_append()

/* rank of this run */
proc sql noprint;
  select count(*) into :rank trimmed
  from sb.scores
  where time < &md_time
    or (time = &md_time
    and score > &md_score);
quit;

%let rank=%eval(&rank+1);

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

data result;
  length rank 8;
  rank=&rank;
  output;
run;

%webout(OPEN)
%webout(OBJ,scores)
%webout(OBJ,result)
%webout(CLOSE)
