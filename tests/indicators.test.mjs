import assert from "node:assert/strict";
import {test} from "node:test";
import {aggregate, areaStats, dayIndex, addDays, stepDay, shownMeanDifference} from "../web/indicators.mjs";

test("comparison difference agrees with the displayed one-decimal means",()=>{
  assert.equal(shownMeanDifference(3.049,3.051),-.1);
  assert.equal(shownMeanDifference(3.051,3.149),0);
  assert.equal(shownMeanDifference(-3.05,-3),-.1);
});

test("rain windows overlap, honor dates and retain the earliest tie",()=>{
  const r=Int16Array.from([1,9,9,1,9,9]);
  assert.deepEqual([...aggregate(r,1,0,5,"storm",1).peaks],[1]);
  assert.deepEqual([...aggregate(r,1,0,5,"storm48",1).values],[18]);
  assert.deepEqual([...aggregate(r,1,0,5,"storm48",1).peaks],[2]);
  assert.deepEqual([...aggregate(r,1,0,5,"storm72",1).peaks],[2]);
  assert.deepEqual([...aggregate(r,1,3,5,"storm48",1).peaks],[5]);
  assert.ok(Number.isNaN(aggregate(r,1,0,1,"storm72",1).values[0]));
});

test("missing days are not zero, but dry cells have a zero without a peak date",()=>{
  const r=Int16Array.from([-32768,0,1,0]);
  const {values,peaks}=aggregate(r,2,0,1,"storm48",10);
  assert.deepEqual([...values],[NaN,0]);
  assert.deepEqual([...peaks],[-1,-1]);
});

test("daily maps use the selected day's reading without summing nearby days",()=>{
  const r=Int16Array.from([20,130,0,-32768,55,60]);
  assert.deepEqual([...aggregate(r,2,1,1,"rainDay",10).values],[0,NaN]);
  assert.deepEqual([...aggregate(r,2,2,2,"max",10).values],[5.5,6]);
  assert.deepEqual([...aggregate(r,2,0,0,"min",10).values],[2,13]);
});

test("area stats count only eligible elevations and include the highest cell's date",()=>{
  const r=areaStats([10,10,NaN,100],[1,1,1,1],[500,550,600,800],1,[0,800],[3,2,-1,1]);
  assert.deepEqual(r,{cells:3,stats:{
    mean:10,min:10,max:10,coverage:2/3,peak:2,count:2,zMean:525,zMin:500,zMax:550
  }});
});

test("solar dates span the change to winter time without an extra hour",()=>{
  assert.equal(dayIndex("2026-10-26","2026-10-24"),2);
  assert.equal(addDays("2026-10-24",2),"2026-10-26");
});

test("daily navigation can reach both archive limits but never crosses them",()=>{
  const limits=["2026-10-25","2026-10-27"];
  assert.equal(stepDay("2026-10-25",-1,...limits),null);
  assert.equal(stepDay("2026-10-26",-1,...limits),"2026-10-25");
  assert.equal(stepDay("2026-10-26",1,...limits),"2026-10-27");
  assert.equal(stepDay("2026-10-27",1,...limits),null);
});

test("province-wide statistics include all valleys but exclude cells outside Trentino",()=>{
  const {cells,stats}=areaStats([100,4,8,NaN],[0,1,2,2],[500,500,550,600],null,[0,800]);
  assert.equal(cells,3);
  assert.equal(stats.mean,6);
  assert.equal(stats.coverage,2/3);
});
