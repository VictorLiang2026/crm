export const GOAL_STAGES = ['新增人才','互动暖客','初次面谈','增员活动','精准面谈','入职申请','签约入司'];
export const MAX_GOAL = 2147483647;
export function previousGoalMonth(month) {
 if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Invalid month');
 const [year,number]=month.split('-').map(Number);
 if(year<2||year>9999)throw Error('Invalid month');
 return number===1?`${String(year-1).padStart(4,'0')}-12`:`${String(year).padStart(4,'0')}-${String(number-1).padStart(2,'0')}`;
}
export function validGoals(goals) {
 const result={};
 for(const stage of GOAL_STAGES){
  const raw=goals[stage];
  if(raw!=null&&typeof raw!=='number'&&typeof raw!=='string')throw Error('Invalid goal');
  const value=raw==null||raw===''?0:Number(raw);
  if(!Number.isSafeInteger(value)||value<0||value>MAX_GOAL)throw Error('Invalid goal');
  result[stage]=value;
 }
 return result;
}
export function reverseGoalDraft(signTarget,benchmarks) {
 const goals=validGoals({[GOAL_STAGES[6]]:signTarget});
 const map=new Map(benchmarks.map(row=>[row.stage_from+'→'+row.stage_to,row]));
 for(let index=5;index>=0;index--){
  const row=map.get(GOAL_STAGES[index]+'→'+GOAL_STAGES[index+1]);
  const rate=Number(row?.conversion_avg);
  if(!Number.isFinite(rate)||rate<=0||rate>100)throw Error('Invalid assumption');
  const value=Math.ceil(goals[GOAL_STAGES[index+1]]*100/rate);
  if(!Number.isSafeInteger(value)||value<0||value>MAX_GOAL)throw Error('Goal overflow');
  goals[GOAL_STAGES[index]]=value;
 }
 return goals;
}
export function goalDraftFromRows(rows){
 if(!Array.isArray(rows)||!rows.length)throw Error('No previous goals');
 const values={};
 for(const row of rows){
  if(!GOAL_STAGES.includes(row.stage)||Object.hasOwn(values,row.stage))throw Error('Invalid previous goals');
  values[row.stage]=row.target_count;
 }
 return validGoals(values);
}
