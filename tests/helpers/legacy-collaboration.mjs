import {createHash} from "node:crypto";

/** Historical-only fixture: the removed user-default assignment workflow must
 * remain readable/reviewable. Publish through the real writer, then represent
 * exactly the pre-upgrade event shape; production code never rewrites history. */
export function publishHistoricalUserAssignment(session, publish, message) {
  const action=message.collaboration;
  if (action?.action!=="assign" || action.reviewer!=="user") return publish(message);
  const id=publish({...message,collaboration:{...action,reviewer:"self"}});
  session.db.updateTranscriptEntry(id,row=>{
    const task=row.collaborationEvent.task;task.reviewer="user";delete task.reviewPolicy;
    const canonical={request_id:action.request_id,action:"assign",goal_message_id:action.goal_message_id,title:action.title,
      assignee:action.assignee,reviewer:"user",criteria:action.criteria,dependencies:action.dependencies??[]};
    row.collaborationEvent.digest=createHash("sha256").update(JSON.stringify([canonical,message.content,message.reply_to,message.work_on])).digest("hex");
    if (row.message?.collaboration) row.message.collaboration=canonical;
    return row;
  });
  return id;
}
