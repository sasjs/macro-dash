/**
  @file
  @brief Record a Macro Dash run
  @details Appends the run to sb.scores and returns the refreshed top 10
  plus the rank of the submitted run.  A run that did NOT reach the
  portal (a death) is recorded with done=0 and a missing time; such DNF
  entries sort after every finisher, by recency (most recent first).

  Input: work.savescore (dataset) - one row with columns:
    name  - player initials (max 12 chars, upcased).  When empty, the
            logged-in SAS user (%mf_getuser) is used instead (multiplayer
            mode never sends a name).
    time  - elapsed seconds (numeric).  Missing => DNF (did not finish).
    score - macro-resolution score (numeric)
    amps  - ampersands collected (numeric)
    done  - 1 if the run reached the portal, 0 if it died (numeric)

  <h4> SAS Macros </h4>
  @li md_init.sas
  @li mf_existds.sas
  @li mf_getuser.sas
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
  length name $12 time 8 score 8 amps 8 done 8 submitted 8;
  set work.savescore(rename=(time=tm score=sc amps=am done=dn));
  /* multiplayer (backend) mode: the name is the logged-in SAS user, not
  a client-supplied initials string - the frontend sends no name and
  we grab it server-side with %mf_getuser().  Local mode never reaches
  this service (no backend). */
  if missing(name) then name=%upcase(%mf_getuser());
  else name=upcase(substr(name,1,12));
  time=tm;
  score=sc;
  amps=am;
  done=min(max(coalesce(dn,0),0),1);
  submitted=datetime();
  keep name time score amps done submitted;
run;

data _null_;
  set newscore;
  call symputx('md_time',time);
  call symputx('md_score',score);
  call symputx('md_done',done);
  call symputx('md_submitted',submitted);
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

/* rank of this run: finishers rank by time (then score); DNFs rank after
  every finisher, most-recent first */
proc sql noprint;
  %if &md_done=1 %then %do;
    select count(*) into :rank trimmed
    from sb.scores
    where done=1
      and (time < &md_time
        or (time = &md_time and score > &md_score));
  %end;
  %else %do;
    select count(*) into :rank trimmed
    from sb.scores
    where done=1
      or (done=0 and submitted > &md_submitted);
  %end;
quit;

%let rank=%eval(&rank+1);

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

data result;
  length rank 8;
  rank=&rank;
  output;
run;

%webout(OPEN)
%webout(OBJ,scores)
%webout(OBJ,result)
%webout(CLOSE)
