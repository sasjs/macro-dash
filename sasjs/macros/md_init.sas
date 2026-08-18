/**
  @file
  @brief Macro Dash service initialisation
  @details Fetches settings (unless already provided), creates the results
  directory and assigns the SB libref when configured.

  The settings are a plain FILE (settings.sas, a single %let statement)
  written directly under the apploc by the configure service
  (%mx_createfile).  There is no deployed settings job - if the file does
  not exist the app is simply unconfigured.

  <h4> SAS Macros </h4>
  @li mf_getapploc.sas
  @li mf_getplatform.sas
  @li mf_mkdir.sas
  @li mfv_existfile.sas
  @li mp_init.sas
  @li ms_getfile.sas

  (%webout is auto-packaged by the SASjs compiler - no @li needed)

**/

%macro md_init();

%global md_rootdir apploc _program _debug sasjs_mdebug;

/* strict mode */
%mp_init()

%let sasjs_mdebug=0;

/* find apploc */
%let apploc=%mf_getapploc(&_program);

/* fetch input tables (work.* datasets from the adapter) - the %webout
  macro is auto-packaged into services by the sasjs compiler */
%webout(FETCH)

/* configure lrecl */
options lrecl=32767;

/* get Macro Dash settings (a plain file under the apploc, written by the
  configure service).  Missing file = unconfigured - not an error. */
%if %length(&md_rootdir)>0 %then %do;
  /* nothing - the settings have already been made (eg autoexec) */
%end;
%else %if %mf_getplatform()=SASVIYA %then %do;
  %if %mfv_existfile(&apploc/settings.sas)=1 %then %do;
    %put &sysmacroname: fetching remote settings;
    filename mdconfg filesrvc folderpath="&apploc" filename="settings.sas";
    %inc mdconfg /source2;
  %end;
%end;
%else %if %mf_getplatform()=SASJS %then %do;
  %put &sysmacroname: fetching remote settings;
  %ms_getfile(&apploc/settings.sas, outref=mdconfg)
  /* a missing file returns a JSON error body - only %inc real settings */
  %local md_valid; %let md_valid=0;
  data _null_;
    infile mdconfg obs=10 end=eof;
    input;
    if index(_infile_,'%let md_rootdir') then call symputx('md_valid',1);
  run;
  %if &md_valid=1 %then %do;
    %inc mdconfg /source2;
  %end;
%end;

/* when configured, assign the results library */
%if %length(&md_rootdir)>0 %then %do;
  %mf_mkdir(&md_rootdir)
  libname SB "&md_rootdir";
%end;

%mend md_init;
