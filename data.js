"use strict";
/* Ferry schedule data. Times are departure-port local time. */
/* ===================================================================
   DATA  ·  days: 0=Sun 1=Mon … 6=Sat
   =================================================================== */
const ALL=[0,1,2,3,4,5,6], SatSun=[6,0], FriSun=[5,6,0], ThuSun=[4,5,6,0],
      SatMon=[6,0,1], SunOnly=[0], MonSatSun=[1,6,0];

const BRANDS={
  sindo:{name:'Sindo',color:'var(--b-sindo)'},
  batamfast:{name:'Batam Fast',color:'var(--b-batamfast)'},
  majestic:{name:'Majestic',color:'var(--b-majestic)'},
  horizon:{name:'Horizon',color:'var(--b-horizon)'},
};
const SG_PORTS=['HarbourFront','Tanah Merah'];
const ID_PORTS=['Batam Centre','Harbour Bay','Sekupang','Gold Coast','Waterfront','Nongsapura'];

/* approximate crossing time in minutes, keyed `sgPort|idPort` */
const DUR={
  'HarbourFront|Batam Centre':90,'HarbourFront|Harbour Bay':60,'HarbourFront|Sekupang':45,
  'HarbourFront|Gold Coast':60,'HarbourFront|Waterfront':60,
  'Tanah Merah|Batam Centre':45,'Tanah Merah|Nongsapura':45,
};

function E(dir,brand,from,to,times,days,extra){
  return times.map(t=>({dir,brand,from,to,time:t,days:days||ALL,...(extra||{})}));
}

const D=[
/* ---------- SINGAPORE → BATAM (SG time) ---------- */
...E('SG','sindo','HarbourFront','Batam Centre',['08:00','09:00','10:20','12:00','13:20','14:50','16:10','17:20','18:30','19:40','20:45','21:50']),
...E('SG','batamfast','HarbourFront','Batam Centre',['07:40','08:40','09:30','10:50','12:30','14:20','15:30','16:50','18:00','19:10','20:20','21:40']),
...E('SG','majestic','HarbourFront','Batam Centre',['08:10','08:50','09:50','10:40','11:45','12:20','13:50','15:20','16:20','17:10','17:50','18:50','20:10','21:20']),

...E('SG','horizon','HarbourFront','Harbour Bay',['08:15','09:10','10:15','11:15','12:15','13:15','14:15','15:15','16:30','17:45','19:00','20:15','21:35']),

...E('SG','sindo','HarbourFront','Sekupang',['08:30','10:00','11:10','14:10','16:00','17:30','18:10','19:30']),
...E('SG','batamfast','HarbourFront','Sekupang',['08:20','11:10','17:30','19:30']),
...E('SG','batamfast','HarbourFront','Sekupang',['09:20'],SatMon),
...E('SG','batamfast','HarbourFront','Sekupang',['10:00','14:10'],ALL,{interline:true}),
...E('SG','batamfast','HarbourFront','Sekupang',['18:10'],FriSun,{interline:true}),
...E('SG','majestic','HarbourFront','Sekupang',['08:45','09:45','12:45','17:40','20:40']),

...E('SG','sindo','HarbourFront','Gold Coast',['07:55','09:35','10:30','13:00','18:25']),
...E('SG','batamfast','HarbourFront','Gold Coast',['10:30']),

...E('SG','sindo','HarbourFront','Waterfront',['10:00','14:10']),

...E('SG','sindo','Tanah Merah','Batam Centre',['10:20','12:30','14:30','16:30','17:40']),
...E('SG','batamfast','Tanah Merah','Batam Centre',['10:20'],ALL,{interline:true}),
...E('SG','batamfast','Tanah Merah','Batam Centre',['12:30','16:30']),
...E('SG','batamfast','Tanah Merah','Batam Centre',['14:30'],FriSun,{interline:true}),
...E('SG','batamfast','Tanah Merah','Batam Centre',['17:40'],SunOnly),
...E('SG','batamfast','Tanah Merah','Batam Centre',['20:10'],ThuSun),
...E('SG','majestic','Tanah Merah','Batam Centre',['08:15','10:30','15:15','18:00','20:45']),
...E('SG','majestic','Tanah Merah','Batam Centre',['09:30'],MonSatSun),
...E('SG','majestic','Tanah Merah','Batam Centre',['12:40','16:45','19:20'],SatSun),

...E('SG','batamfast','Tanah Merah','Nongsapura',['08:00','08:50','10:50','12:00','14:20','16:20','18:30','20:20']),

/* ---------- BATAM → SINGAPORE (WIB) ---------- */
...E('ID','sindo','Batam Centre','HarbourFront',['06:00','07:20','08:40','10:40','12:40','14:00','15:10','16:10','17:20','18:20','19:30','20:20']),
...E('ID','batamfast','Batam Centre','HarbourFront',['06:00','07:00','08:20','09:50','11:10','12:50','14:10','15:20','16:30','17:40','19:00','20:30']),
...E('ID','majestic','Batam Centre','HarbourFront',['06:00','07:10','08:20','09:30','10:20','11:30','12:20','13:30','14:30','15:15','16:00','17:30','18:30','20:35']),

...E('ID','horizon','Harbour Bay','HarbourFront',['06:00','07:15','08:30','09:45','10:45','11:45','12:45','14:00','15:30','16:30','17:30','19:15','20:30']),

...E('ID','sindo','Sekupang','HarbourFront',['06:00','07:00','08:30','11:20','12:30','13:50','15:20','17:40','18:30']),
...E('ID','batamfast','Sekupang','HarbourFront',['06:00','08:30','12:30','17:40']),
...E('ID','batamfast','Sekupang','HarbourFront',['07:00','11:20','15:20'],ALL,{interline:true}),
...E('ID','batamfast','Sekupang','HarbourFront',['15:30'],FriSun),
...E('ID','batamfast','Sekupang','HarbourFront',['18:30'],FriSun,{interline:true}),
...E('ID','majestic','Sekupang','HarbourFront',['06:00','09:00','13:10','16:20','18:00']),

...E('ID','sindo','Gold Coast','HarbourFront',['08:10','10:30','14:00','15:30','19:00']),
...E('ID','batamfast','Gold Coast','HarbourFront',['15:30'],ALL,{interline:true}),
...E('ID','batamfast','Gold Coast','HarbourFront',['19:00']),

...E('ID','sindo','Waterfront','HarbourFront',['13:20','14:50']),

...E('ID','sindo','Batam Centre','Tanah Merah',['08:00','09:20','11:30','13:20']),
...E('ID','batamfast','Batam Centre','Tanah Merah',['09:20','13:20']),
...E('ID','batamfast','Batam Centre','Tanah Merah',['08:00'],ALL,{interline:true}),
...E('ID','batamfast','Batam Centre','Tanah Merah',['07:45'],ThuSun),
...E('ID','batamfast','Batam Centre','Tanah Merah',['11:30'],FriSun,{interline:true}),
...E('ID','majestic','Batam Centre','Tanah Merah',['06:15','08:25','12:00','15:30','18:00']),
...E('ID','majestic','Batam Centre','Tanah Merah',['09:40','13:00','17:00'],SatSun),
...E('ID','majestic','Batam Centre','Tanah Merah',['19:50'],FriSun),

...E('ID','batamfast','Nongsapura','Tanah Merah',['06:00','08:00','09:30','12:10','14:20','15:40','17:30','20:00']),
];
