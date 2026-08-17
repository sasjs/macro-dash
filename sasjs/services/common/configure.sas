/**
  @file
  @brief Configure the Macro Dash results folder
  @details Called from the in-game configuration screen.  Validates the
  chosen folder (creates it if needed, checks it is writable), then rewrites
  the settings job so the choice persists for all users.  On SASjs Server it
  also flips the configured="false" attribute in the streamed index.html
  (on SASjs Drive) to "true", so the page knows immediately on load.

  Input: work.config (dataset) - one row, column rootdir = target folder for
  scores.sas7bdat

  <h4> SAS Macros </h4>
  @li sb_init.sas
  @li ms_getfile.sas
  @li mf_getplatform.sas
  @li mf_getuniquefileref.sas
  @li mf_mkdir.sas
  @li mp_abort.sas
  @li mx_createfile.sas
**/

%sb_init()
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

%mp_abort(iftrue= (%length(&rootdir)=0)
  ,mac=&_program
  ,msg=%str(No rootdir provided)
)

/* validate: create the folder and prove we can write a dataset there */
%mf_mkdir(&rootdir)
libname sbt "&rootdir";

data sbt.sb_write_test;
  x=1;
run;

%mp_abort(iftrue= (&syserr ne 0)
  ,mac=&_program
  ,msg=%str(Cannot write to &rootdir - check permissions)
)

proc sql;
  drop table sbt.sb_write_test;
quit;
libname sbt clear;

/* persist: rewrite the settings job with the new rootdir */
filename sbset temp;
data _null_;
  file sbset;
  put '/**'
    / '  @file'
    / '  @brief Macro Dash global settings - written by the configure service'
    / '**/';
  put '%let sb_rootdir=' @;
  put "&rootdir" +(-1) ';';
run;

%mx_createfile(&apploc/jobs/common/settings
  ,inref=sbset
)

/* update the session too, so config takes effect immediately */
%let sb_rootdir=&rootdir;
%mf_mkdir(&sb_rootdir)
libname SB "&sb_rootdir";

/* flip the configured flag in index.html, so the page knows immediately
  (without a getconfig round trip) that a backend results folder exists.
  On SASjs Server the streamed web files live on SASjs Drive, so we can
  rewrite the file in place.  On Viya the web content is compiled into the
  stream service itself, so the frontend falls back to getconfig there. */
%if %mf_getplatform()=SASJS %then %do;
  %ms_getfile(&apploc/services/web/index.html, outref=sbhtml)
  filename sbhtml2 temp;
  data _null_;
    infile sbhtml lrecl=32767;
    file sbhtml2 lrecl=32767;
    input;
    _infile_=tranwrd(_infile_,'configured="false"','configured="true"');
    put _infile_;
  run;
  %mx_createfile(&apploc/services/web/index.html
    ,inref=sbhtml2
  )
%end;

/* Viya: stamp the selected compute context into the streamed frontend
  (MacroDash.html), so future sessions run under it by default - same
  pattern as Data Controller's makedata service.  Non-fatal on failure:
  the configuration itself is already saved by this point. */
%if %mf_getplatform()=VIYA and %symexist(_contextname)
  and %length(%superq(_contextname))>0 %then %do;
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
    line=prxchange(cats('s|contextname="[^"]*"|contextname="'
      ,symget('_contextname'),'"|i'),-1,line);
    put line;
  run;

  %if &syscc ne 0 %then
    %put WARNING: &_program: unable to stamp contextname in MacroDash.html;

  proc datasets lib=work nolist nowarn;
    delete mdhtml;
  quit;
  filename &mdhtml_fref clear;
%end;

data result;
  length status $32 rootdir $256;
  status='configured';
  rootdir=symget('sb_rootdir');
  output;
run;

%webout(OPEN)
%webout(OBJ,result)
%webout(CLOSE)
