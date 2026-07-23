import {
  ArrowLeft, CheckCircle2, CircleDot, Inbox, LoaderCircle, MessageSquare,
  Plus, Send, TicketCheck, UserRound
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, isAbortError } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Ticket, User } from "../types";

export function TicketPanel({ user, onToast }: { user: User; onToast: (message: string) => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [active, setActive] = useState<Ticket>();
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    return api.tickets(signal).then(({ tickets: data }) => setTickets(data));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((error) => {
      if (!isAbortError(error)) onToast((error as Error).message);
    });
    return () => controller.abort();
  }, [load, onToast]);

  const openTicket = async (ticket: Ticket) => {
    setBusy(true);
    try {
      const { ticket: detail } = await api.ticket(ticket.id);
      setActive(detail);
      setCreating(false);
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { ticket } = await api.createTicket(subject, message);
      setActive(ticket);
      setSubject("");
      setMessage("");
      setCreating(false);
      await load();
      onToast("工单已提交");
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!active) return;
    setBusy(true);
    try {
      const { ticket } = await api.replyTicket(active.id, reply);
      setActive(ticket);
      setReply("");
      await load();
      onToast("回复已发送");
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: Ticket["status"]) => {
    if (!active) return;
    setBusy(true);
    try {
      const { ticket } = await api.patchTicket(active.id, status);
      setActive(ticket);
      await load();
      onToast(status === "closed" ? "工单已关闭" : "工单已重新打开");
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ticket-page">
      <div className="page-heading">
        <div><h1>工单</h1><p>{user.role === "admin" ? "查看并回复所有用户提交的问题。" : "向管理员反馈问题并跟踪回复。"}</p></div>
        {user.role !== "admin" && <button className="button button--primary" onClick={() => { setCreating(true); setActive(undefined); }}><Plus />新建工单</button>}
      </div>

      <div className="ticket-layout">
        <aside className="ticket-list">
          <div className="ticket-list__head"><Inbox /><strong>全部工单</strong><span>{tickets.length}</span></div>
          {tickets.length ? tickets.map((ticket) => (
            <button key={ticket.id} className={active?.id === ticket.id ? "is-active" : ""} onClick={() => void openTicket(ticket)}>
              <span className={`ticket-status-dot is-${ticket.status}`} />
              <span><strong>{ticket.subject}</strong><small>{user.role === "admin" ? `${ticket.userName} · ` : ""}{formatDate(ticket.updatedAt)}</small></span>
              <i>{ticket.messageCount}</i>
            </button>
          )) : <div className="ticket-empty"><MessageSquare /><span>还没有工单</span></div>}
        </aside>

        <div className="ticket-content">
          {creating ? (
            <form className="ticket-compose" onSubmit={create}>
              <div className="ticket-content__head"><button type="button" className="icon-button" onClick={() => setCreating(false)}><ArrowLeft /></button><span><h2>新建工单</h2><p>请清楚描述遇到的问题</p></span></div>
              <label className="field"><span>主题</span><input value={subject} onChange={(event) => setSubject(event.target.value)} minLength={2} maxLength={120} placeholder="例如：文件预览无法打开" required /></label>
              <label className="field"><span>详细信息</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={2} maxLength={5000} rows={10} placeholder="请提供复现步骤、文件类型和错误提示…" required /></label>
              <div className="form-actions"><button className="button button--primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Send />}提交工单</button></div>
            </form>
          ) : active ? (
            <>
              <div className="ticket-content__head">
                <button className="icon-button ticket-back" onClick={() => setActive(undefined)}><ArrowLeft /></button>
                <span><h2>{active.subject}</h2><p>{active.userName} · {active.userEmail} · 创建于 {formatDate(active.createdAt)}</p></span>
                <span className={`ticket-status is-${active.status}`}>{active.status === "open" ? <CircleDot /> : <CheckCircle2 />}{active.status === "open" ? "处理中" : "已关闭"}</span>
              </div>
              <div className="ticket-thread">
                {active.messages?.map((item) => (
                  <article key={item.id} className={item.senderId === user.id ? "is-self" : ""}>
                    <span className="avatar"><UserRound /></span>
                    <div><header><strong>{item.senderName}</strong><small>{item.senderRole === "admin" ? "管理员" : "用户"} · {formatDate(item.createdAt)}</small></header><p>{item.message}</p></div>
                  </article>
                ))}
              </div>
              <form className="ticket-reply" onSubmit={sendReply}>
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={5000} rows={3} placeholder="输入回复内容…" required />
                <div>
                  {user.role === "admin" && <button type="button" className="button button--secondary" onClick={() => void setStatus(active.status === "open" ? "closed" : "open")} disabled={busy}><TicketCheck />{active.status === "open" ? "关闭工单" : "重新打开"}</button>}
                  <button className="button button--primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Send />}发送回复</button>
                </div>
              </form>
            </>
          ) : (
            <div className="ticket-placeholder"><MessageSquare /><h2>选择一个工单</h2><p>查看对话内容并继续回复。</p></div>
          )}
        </div>
      </div>
    </section>
  );
}
