/**
  @file
  @brief Macro Dash service initialisation
  @details Fetches settings (unless already provided), creates the results
  directory and assigns the SB libref when configured.

  <h4> SAS Macros </h4>
  @li mf_getapploc.sas
  @li mf_mkdir.sas
  @li mp_init.sas
  @li mx_getcode.sas

  (%webout is auto-packaged by the SASjs compiler - no @li needed)

**/

%macro sb_init();

%global sb_rootdir apploc _program _debug sasjs_mdebug;

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

/* get Macro Dash settings */
%if %length(&sb_rootdir)>0 %then %do;
  /* nothing - the settings have already been made (eg autoexec) */
%end;
%else %if %scan(&_program,-1,/) ne settings %then %do;
  /* calling settings from settings would be an infinite loop! */
  %put &sysmacroname: fetching remote settings;
  %mx_getcode(&apploc/jobs/common/settings,outref=sbconfg)
  %inc sbconfg /source2;
%end;

/* when configured, assign the results library */
%if %length(&sb_rootdir)>0 %then %do;
  %mf_mkdir(&sb_rootdir)
  libname SB "&sb_rootdir";
%end;

%mend sb_init;
