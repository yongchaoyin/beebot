import { expressionPose, identitySeed, type AvatarExpression, type ExpressionPose } from "./avatar-expression.ts";

/** BeeBot-authored, finite presentation accents. They never select a work state,
 * modify identity artwork or imply that a tool succeeded. */
export interface ActivityStep { pose: ExpressionPose; duration: number; hold: number }
export interface ActivityChoreography {
  steps: ActivityStep[];
  body?: { frames: Keyframe[]; duration: number };
}
export function activityDelay(expression: AvatarExpression, identity: string, cycle: number): number {
  const spread = identitySeed(`${identity}:${expression}:activity:${cycle}`);
  return expression === "speaking" ? 1900 + spread % 1400 : 3600 + spread % 2600;
}
export function activityChoreography(expression: AvatarExpression, identity: string, cycle: number): ActivityChoreography {
  const base = expressionPose(expression), steps: ActivityStep[] = [];
  const direction = identitySeed(`${identity}:${expression}:${cycle}`) % 2 ? 1 : -1;
  const step = (change: (pose: ExpressionPose) => void, duration: number, hold = 0) => {
    const next = expressionPose(expression); change(next); steps.push({pose:next,duration,hold});
  };
  let body: ActivityChoreography["body"];
  switch (expression) {
    case "thinking":
      step(p => {p.lookX=.55*direction;p.lookY=-1.1;p.left.height+=.4;p.right.height-=.25;},300,420);
      break;
    case "reading":
      step(p => {p.lookX=-1.25;p.lookY=.65;},220,130);
      step(p => {p.lookX=.05;p.lookY=.8;},280,100);
      step(p => {p.lookX=1.15;p.lookY=1.05;},250,170);
      break;
    case "searching":
      step(p => {p.lookX=-1.5*direction;p.lookY=-.15;p.left.height+=.7;p.right.height+=.7;},280,230);
      step(p => {p.lookX=1.5*direction;p.lookY=-.15;p.left.height+=.45;p.right.height+=.45;},420,250);
      break;
    case "writing":
      step(p => {p.lookX=.35;p.lookY=1.1;p.left.height-=.4;p.right.height-=.4;},260,180);
      step(p => {p.lookX=-.4;p.lookY=.85;p.left.height-=.15;p.right.height-=.15;},220,160);
      body={frames:[{transform:"none"},{transform:"translateY(.45px) rotate(.55deg)",offset:.35},{transform:"translateY(.2px) rotate(-.25deg)",offset:.68},{transform:"none"}],duration:1080};
      break;
    case "working":
      step(p => {p.left.height-=.35;p.right.height-=.35;p.mouth.bend+=.2;},420,440);
      body={frames:[{transform:"none"},{transform:"translateY(.25px) scale(1.014,.99)",offset:.48},{transform:"none"}],duration:1450};
      break;
    case "handoff":
      step(p => {p.lookX=1.55*direction;p.lookY=-.2;p.mouth.bend+=.6;},280,380);
      body={frames:[{transform:"none"},{transform:`translateX(${.7*direction}px) rotate(${1.2*direction}deg)`,offset:.4},{transform:"none"}],duration:1050};
      break;
    case "speaking":
      step(p => {p.mouth.open=2.1;p.mouth.width=6.1;},140,60);
      step(p => {p.mouth.open=4.25;p.mouth.width=6.8;p.lookX=.35*direction;},190,90);
      step(p => {p.mouth.open=2.65;p.mouth.width=6.35;},160,80);
      body={frames:[{transform:"none"},{transform:"translateY(-.6px) rotate(-.7deg)",offset:.32},{transform:"translateY(.25px) rotate(.35deg)",offset:.63},{transform:"none"}],duration:1080};
      break;
    default:
      body={frames:[{transform:"none"},{transform:"translateY(-.65px) scale(1.012)",offset:.5},{transform:"none"}],duration:2100};
  }
  if (steps.length) steps.push({pose:base,duration:360,hold:0});
  return {steps,...(body ? {body} : {})};
}
