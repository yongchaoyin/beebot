import { expressionPose, identitySeed, type AvatarExpression, type ExpressionPose } from "./avatar-expression.ts";

/** BeeBot-authored, finite presentation accents. They never select a work state,
 * modify identity artwork or imply that a tool succeeded. */
export interface ActivityStep { pose: ExpressionPose; duration: number; hold: number }
export interface ActivityChoreography {
  steps: ActivityStep[];
  body?: { frames: Keyframe[]; duration: number };
}
export function ambientDelay(identity: string, cycle: number): number {
  return 1400 + identitySeed(`${identity}:ambient-pause:${cycle}`) % 1401;
}
/** An idle colleague's brief mannerism, independent of any task/expression
 * selection. Every pose returns to the same idle baseline within this episode. */
export function ambientChoreography(identity: string, cycle: number): ActivityChoreography & { blink: boolean } {
  const seed = identitySeed(`${identity}:ambient:${cycle}`), variant = seed % 4;
  const pose = expressionPose("idle"), direction = (seed >>> 8) % 2 ? 1 : -1;
  // On a 28px sidebar avatar, one 64-unit canvas pixel is only .44 screen
  // pixels. Pair the face change with a finite 2.4–2.8-unit body accent so that
  // every granted episode is visible, including shapes with a narrow gaze fit.
  let transform = `translateX(${2.4 * direction}px) rotate(${2 * direction}deg)`;
  if (variant === 0) { pose.lookX = 1.8 * direction; pose.lookY = -.5; }
  if (variant === 1) {
    pose.left.height -= 2.2; pose.right.height -= 2.2;
    pose.left.bend -= 1.1; pose.right.bend -= 1.1; pose.mouth.bend += 1.4;
    transform = "translateY(-2.4px) scale(1.035)";
  }
  if (variant === 2) {
    pose.lookY = 1.1; pose.left.height -= 1.2; pose.right.height -= 1.2;
    transform = "translateY(2.8px) scaleY(.96)";
  }
  if (variant === 3) {
    pose.lookX = 1.35 * direction; pose.lookY = -.6;
    pose.left.height += 1; pose.right.height -= 1.4; pose.mouth.bend += .9;
    transform = `translateY(-2.4px) rotate(${-2.5 * direction}deg)`;
  }
  const body = {frames:[{transform:"none"},{transform,offset:.32},{transform,offset:.7},{transform:"none"}],duration:1720};
  const steps = [{pose,duration:320,hold:1000},{pose:expressionPose("idle"),duration:400,hold:0}];
  return {steps,blink:variant === 3,body};
}
export function activityDelay(expression: AvatarExpression, identity: string, cycle: number): number {
  const spread = identitySeed(`${identity}:${expression}:activity:${cycle}`);
  return expression === "speaking" ? 1300 + spread % 1000 : 2100 + spread % 1500;
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
      step(p => {p.lookX=1.4*direction;p.lookY=-1.2;p.left.height+=.85;p.right.height-=.65;},300,650);
      body={frames:[{transform:"none"},{transform:`translateY(-2.4px) rotate(${1.8*direction}deg)`,offset:.45},{transform:"none"}],duration:1500};
      break;
    case "reading":
      step(p => {p.lookX=-1.25;p.lookY=.65;},220,130);
      step(p => {p.lookX=.05;p.lookY=.8;},280,100);
      step(p => {p.lookX=1.15;p.lookY=1.05;},250,170);
      body={frames:[{transform:"none"},{transform:"translateX(-2.4px) rotate(-1deg)",offset:.28},{transform:"translateX(2.4px) rotate(1deg)",offset:.68},{transform:"none"}],duration:1550};
      break;
    case "searching":
      step(p => {p.lookX=-1.8*direction;p.lookY=-.15;p.left.height+=1;p.right.height+=1;},280,230);
      step(p => {p.lookX=1.8*direction;p.lookY=-.15;p.left.height+=.7;p.right.height+=.7;},420,250);
      body={frames:[{transform:"none"},{transform:`translateX(${-2.4*direction}px) rotate(${-2*direction}deg)`,offset:.28},{transform:`translateX(${2.4*direction}px) rotate(${2*direction}deg)`,offset:.68},{transform:"none"}],duration:1600};
      break;
    case "writing":
      step(p => {p.lookX=.35;p.lookY=1.1;p.left.height-=.4;p.right.height-=.4;},260,180);
      step(p => {p.lookX=-.4;p.lookY=.85;p.left.height-=.15;p.right.height-=.15;},220,160);
      body={frames:[{transform:"none"},{transform:"translateY(2.4px) rotate(1.8deg)",offset:.35},{transform:"translateY(1.2px) rotate(-.9deg)",offset:.68},{transform:"none"}],duration:1350};
      break;
    case "working":
      step(p => {p.left.height-=1;p.right.height-=1;p.mouth.bend+=.5;},420,600);
      body={frames:[{transform:"none"},{transform:"translateY(2.4px) scale(1.035,.97)",offset:.48},{transform:"none"}],duration:1600};
      break;
    case "handoff":
      step(p => {p.lookX=1.55*direction;p.lookY=-.2;p.mouth.bend+=.6;},280,380);
      body={frames:[{transform:"none"},{transform:`translateX(${2.8*direction}px) rotate(${3*direction}deg)`,offset:.4},{transform:"none"}],duration:1400};
      break;
    case "speaking":
      step(p => {p.mouth.open=2.1;p.mouth.width=6.1;},140,60);
      step(p => {p.mouth.open=5.5;p.mouth.width=7;p.lookX=.6*direction;},190,90);
      step(p => {p.mouth.open=2.65;p.mouth.width=6.35;},160,80);
      body={frames:[{transform:"none"},{transform:"translateY(-2.4px) rotate(-1.8deg)",offset:.32},{transform:"translateY(1.2px) rotate(.9deg)",offset:.63},{transform:"none"}],duration:1250};
      break;
    default:
      body={frames:[{transform:"none"},{transform:"translateY(-2.4px) scale(1.035)",offset:.5},{transform:"none"}],duration:1720};
  }
  if (steps.length) steps.push({pose:base,duration:360,hold:0});
  return {steps,...(body ? {body} : {})};
}
