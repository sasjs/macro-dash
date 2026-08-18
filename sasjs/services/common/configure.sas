/**
  @file
  @brief Configure the Macro Dash results folder
  @details Called from the in-game configuration screen.  Validates the
  chosen folder (creates it if needed, checks it is writable), then writes
  the settings file so the choice persists for all users.  It also flips the
  configured="false" attribute in the streamed frontend to "true" - on
  SASjs Server via Drive API on index.html, on Viya via a filesrvc fileref on
  MacroDash.html (same pass that stamps the chosen compute context, runAsTask
  and useComputeApi) - so the page knows immediately on load.

  Input: work.config (dataset) - one row, column rootdir = target folder for
  scores.sas7bbat

  <h4> SAS Macros </h4>
  @li md_init.sas
  @li ms_getfile.sas
  @li mf_getplatform.sas
  @li mf_existvar.sas
  @li mf_getuniquefileref.sas
  @li mf_mkdir.sas
  @li mp_abort.sas
  @li mx_createfile.sas
**/

%md_init()
%global sasjs_mdebug;

/* input table arrives as work.config via the sasjs_tables mechanism */
%mp_abort(iftrue= (%mf_existds(work.config)=0)
  ,mac=&_program
  ,msg=%str(No config input table provided)
)

data _null_;
  set work.config;
  call symputx('rootdir',rootdir);
run;

/* optional runastask / usecomputeapi flags (Viya only) - stamped into
  MacroDash.html so future sessions default to the chosen execution mode.
  usecomputeapi is NOT an automatic variable - the frontend sends it as a
  column on the config table. */
%global md_runastask md_usecomputeapi md_contextname;
%let md_runastask=;
%let md_usecomputeapi=;
%let md_contextname=;
%macro md_read_optflags();
%if %mf_existvar(work.config,runastask) %then %do;
  data _null_;
    set work.config;
    call symputx('md_runastask',runastask);
  run;
%end;
%if %mf_existvar(work.config,usecomputeapi) %then %do;
  data _null_;
    set work.config;
    call symputx('md_usecomputeapi',usecomputeapi);
  run;
%end;
/* JES request params (like _contextname) are NOT auto-promoted to macro
  variables, so the frontend sends the chosen context as a column instead. */
%if %mf_existvar(work.config,contextname) %then %do;
  data _null_;
    set work.config;
    call symputx('md_contextname',contextname);
  run;
%end;
%mend md_read_optflags;
%md_read_optflags()

%mp_abort(iftrue= (%length(&rootdir)=0)
  ,mac=&_program
  ,msg=%str(No rootdir provided)
)

/* validate: create the folder and prove we can write a dataset there */
%mf_mkdir(&rootdir)
libname mdt "&rootdir";

data mdt.md_write_test;
  x=1;
run;

%mp_abort(iftrue= (&syserr ne 0)
  ,mac=&_program
  ,msg=%str(Cannot write to &rootdir - check permissions)
)

proc sql;
  drop table mdt.md_write_test;
quit;
libname mdt clear;

/* persist: write the settings file with the new rootdir. */
filename mdset temp;
data _null_;
  file mdset;
  put '/**'
    / '  @file'
    / '  @brief Macro Dash global settings - written by the configure service'
    / '**/';
  put '%let md_rootdir=' @;
  put "&rootdir" +(-1) ';';
run;

/* The settings are a couple of %let statements - plain FILE content.
  %mx_createfile stores it directly under the apploc on every platform
  (no settings job, no jobs folder). */
%mx_createfile(&apploc/settings.sas
  ,inref=mdset
)

/* update the session too, so config takes effect immediately */
%let md_rootdir=&rootdir;
%mf_mkdir(&md_rootdir)
libname SB "&md_rootdir";

/* flip the configured flag in the streamed frontend, so the page knows
  immediately (synchronously, without any service round trip) that a
  backend results folder exists.  On SASjs Server the streamed web files
  live on SASjs Drive (rewrite index.html in place); on Viya the web
  content is compiled into the stream service itself (stamp MacroDash.html
  via a filesrvc fileref, in the same pass stamping the chosen compute
  context, runAsTask and useComputeApi).  Non-fatal on failure: the
  configuration itself is already saved by this point. */
%macro md_stamp_frontend();
%global md_stamp_failed;
%let md_stamp_failed=0;

%if %mf_getplatform()=SASJS %then %do;
  %ms_getfile(&apploc/services/web/index.html, outref=mdhtml)
  filename mdhtml2 temp;
  data _null_;
    infile mdhtml lrecl=32767;
    file mdhtml2 lrecl=32767;
    input;
    _infile_=tranwrd(_infile_,'configured="false"','configured="true"');
    put _infile_;
  run;
  %mx_createfile(&apploc/services/web/index.html
    ,inref=mdhtml2
  )
%end;
%else %if %mf_getplatform()=SASVIYA and %length(&md_contextname)>0 %then %do;
  %local mdhtml_fref;
  %let mdhtml_fref=%mf_getuniquefileref();

  filename &mdhtml_fref filesrvc folderpath="&apploc/services"
    filename="MacroDash.html" lrecl=32767;

  data mdhtml;
    infile &mdhtml_fref lrecl=32767 truncover;
    input;
    length line $32767;
    line=_infile_;
  run;

  filename &mdhtml_fref filesrvc folderpath="&apploc/services"
    filename="MacroDash.html" lrecl=32767;
  data _null_;
    file &mdhtml_fref lrecl=32767;
    set mdhtml;
    line=prxchange('s/configured="false"/configured="true"/i',-1,line);
    line=prxchange(cats('s|contextname="[^"]*"|contextname="'
      ,symget('md_contextname'),'"|i'),-1,line);
    %if %length(&md_runastask)>0 %then %do;
    line=prxchange(cats('s|runastask="[^"]*"|runastask="'
      ,symget('md_runastask'),'"|i'),-1,line);
    %end;
    %if %length(&md_usecomputeapi)>0 %then %do;
    line=prxchange(cats('s|usecomputeapi="[^"]*"|usecomputeapi="'
      ,symget('md_usecomputeapi'),'"|i'),-1,line);
    %end;
    put line;
  run;

  %if &syscc ne 0 %then
    %put WARNING: &_program: unable to stamp MacroDash.html;

  /* verify the stamp will land: confirm the source file actually
    contained configured="false" (so the prxchange had something to
    match).  The filesrvc write itself is reliable (verified end-to-end:
    a curl _FILE fetch after configure shows configured="true"), so we
    just guard against the silent failure where the attribute was already
    set or the pattern drifted. */
  data _null_;
    set mdhtml end=eof;
    retain found 0;
    if find(line,'configured="false"') then found=1;
    if eof and not found then do;
      call symputx('md_stamp_failed',1);
      put 'ERROR: MacroDash.html has no configured="false" attribute'
        / ' to stamp - check the deployed HTML';
    end;
  run;

  proc datasets lib=work nolist nowarn;
    delete mdhtml;
  quit;
  filename &mdhtml_fref clear;
%end;
%mend md_stamp_frontend;
%md_stamp_frontend()

%mp_abort(iftrue= (%symexist(md_stamp_failed) and %superq(md_stamp_failed)=1)
  ,mac=&_program
  ,msg=%str(Configuration saved but the frontend stamp did not land -
    check write access to the streamed HTML)
)

data result;
  length status $32 rootdir $256;
  status='configured';
  rootdir=symget('md_rootdir');
  output;
run;

%webout(OPEN)
%webout(OBJ,result)
%webout(CLOSE)
