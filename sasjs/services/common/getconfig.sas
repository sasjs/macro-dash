/**
  @file
  @brief Returns Macro Dash configuration status
  @details Tells the frontend whether a results folder has been configured,
  so it can decide between localStorage-only mode and the backend leaderboard.

  <h4> SAS Macros </h4>
  @li sb_init.sas
**/

%sb_init()

data config;
  length configured 8 rootdir $256;
  configured=%length(&sb_rootdir)>0;
  rootdir=symget('sb_rootdir');
  output;
run;

%webout(OPEN)
%webout(OBJ,config)
%webout(CLOSE)
