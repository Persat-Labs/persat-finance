"use client";
import { useState } from "react";
import { useProtocol } from "@/lib/protocol/hooks";
import { useDirectMessages, DealProposalAttachment } from "@/lib/messages/messagesStore";
import { getProfileByWalletOrUsername } from "@/lib/profile/userProfile";
import { Button, Input } from "@/lib/design-system";

export function MessagesDrawer({
  open,
  onClose,
  initialPartner,
}: {
  open: boolean;
  onClose: () => void;
  initialPartner?: string | null;
}) {
  const { publicKey } = useProtocol();
  const myWallet = publicKey ? publicKey.toBase58() : null;
  const {
    messages,
    conversationPartners,
    sendMessage,
    updateProposalStatus,
  } = useDirectMessages(myWallet);

  const [activePartner, setActivePartner] = useState<string | null>(initialPartner || null);
  const [newMsgText, setNewMsgText] = useState("");
  const [showProposeCard, setShowProposeCard] = useState(false);
  const [propPrincipal, setPropPrincipal] = useState("1000");
  const [propRate, setPropRate] = useState("800");
  const [propMonths, setPropMonths] = useState(12);

  // Sync initial partner
  if (initialPartner && activePartner !== initialPartner) {
    setActivePartner(initialPartner);
  }

  if (!open) return null;

  const currentPartnerProfile = activePartner ? getProfileByWalletOrUsername(activePartner) : null;
  const partnerName = currentPartnerProfile?.username
    ? `@${currentPartnerProfile.username}`
    : activePartner
    ? `${activePartner.slice(0, 6)}…${activePartner.slice(-4)}`
    : "Select Conversation";

  const partnerMessages = activePartner
    ? messages.filter(
        (m) =>
          myWallet &&
          ((m.senderWallet === myWallet && m.recipientWallet === activePartner) ||
            (m.senderWallet === activePartner && m.recipientWallet === myWallet)),
      )
    : [];

  const handleSend = () => {
    if (!activePartner || !newMsgText.trim()) return;
    let proposal: DealProposalAttachment | undefined = undefined;
    if (showProposeCard) {
      proposal = {
        principal: propPrincipal,
        currency: "USDC",
        collateralBtc: (Number(propPrincipal) * 0.00005).toFixed(4),
        rateBps: propRate,
        months: propMonths,
        side: "lender",
        status: "proposed",
      };
    }
    sendMessage(activePartner, newMsgText.trim(), proposal);
    setNewMsgText("");
    setShowProposeCard(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm animate-reveal">
      <div className="glass sheen flex h-full w-full max-w-md flex-col border-l border-white/15 bg-black/90 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber/20 text-amber">
              💬
            </span>
            <div>
              <h2 className="font-display-persat text-lg uppercase text-white">Deal Messages</h2>
              <p className="font-mono text-[11px] text-white/50">
                {myWallet ? `${myWallet.slice(0, 4)}…${myWallet.slice(-4)}` : "Connect Wallet"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center font-mono text-lg text-white/50 hover:text-amber transition"
            title="Dismiss"
          >
            *
          </button>
        </div>

        {/* Partners List / Thread selector */}
        <div className="flex gap-2 overflow-x-auto border-b border-white/10 py-3">
          {conversationPartners.length === 0 ? (
            <p className="font-mono text-xs text-white/40">No conversations yet.</p>
          ) : (
            conversationPartners.map((partner) => {
              const prof = getProfileByWalletOrUsername(partner);
              const label = prof?.username ? `@${prof.username}` : `${partner.slice(0, 4)}…`;
              const isSelected = activePartner === partner;
              return (
                <button
                  key={partner}
                  onClick={() => setActivePartner(partner)}
                  className={`shrink-0 rounded-full border px-3 py-1 font-mono text-xs transition ${
                    isSelected
                      ? "border-amber bg-amber/15 text-white"
                      : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              );
            })
          )}
        </div>

        {/* Active Chat Body */}
        {activePartner ? (
          <div className="flex flex-1 flex-col overflow-hidden pt-3">
            <div className="mb-2 flex items-center justify-between font-mono text-xs text-amber">
              <span>Chatting with {partnerName}</span>
              <a href={`/profile/${activePartner}`} className="underline hover:text-white">
                View Profile ↗
              </a>
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {partnerMessages.map((msg) => {
                const isMe = msg.senderWallet === myWallet;
                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl p-3.5 text-xs leading-5 ${
                        isMe
                          ? "bg-gradient-to-r from-amber/30 to-amber/20 text-white border border-amber/40"
                          : "bg-white/[0.06] text-white/90 border border-white/10"
                      }`}
                    >
                      <p className="font-semibold mb-1 text-[10px] text-amber">
                        {isMe ? "You" : `@${msg.senderHandle}`}
                      </p>
                      <p>{msg.text}</p>

                      {/* Embedded Deal Proposal Card */}
                      {msg.dealProposal && (
                        <div className="mt-2.5 rounded-xl border border-white/20 bg-black/40 p-3 font-mono text-[11px]">
                          <div className="flex justify-between font-semibold text-amber mb-1">
                            <span>PROPOSED DEAL</span>
                            <span>{msg.dealProposal.status.toUpperCase()}</span>
                          </div>
                          <p>
                            Amount: {msg.dealProposal.principal} {msg.dealProposal.currency}
                          </p>
                          <p>Collateral: {msg.dealProposal.collateralBtc} tBTC</p>
                          <p>Rate: {Number(msg.dealProposal.rateBps) / 100}% APR · {msg.dealProposal.months} mo</p>

                          {!isMe && msg.dealProposal.status === "proposed" && (
                            <div className="mt-2 flex gap-2 pt-2 border-t border-white/10">
                              <button
                                onClick={() => updateProposalStatus(msg.id, "accepted")}
                                className="rounded-lg bg-emerald-500/20 px-2.5 py-1 text-emerald-300 hover:bg-emerald-500/30"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => updateProposalStatus(msg.id, "declined")}
                                className="rounded-lg bg-red-500/20 px-2.5 py-1 text-red-300 hover:bg-red-500/30"
                              >
                                Decline
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="mt-1 font-mono text-[10px] text-white/30">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Proposal Builder Drawer */}
            {showProposeCard && (
              <div className="rounded-xl border border-amber/30 bg-black/80 p-3 my-2 font-mono text-xs space-y-2">
                <p className="text-amber font-semibold">Attach Structured Deal Terms</p>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    value={propPrincipal}
                    onChange={(e) => setPropPrincipal(e.target.value)}
                    placeholder="USDC"
                    className="rounded border border-white/15 bg-white/[0.04] p-1.5 text-white"
                  />
                  <input
                    type="number"
                    value={propRate}
                    onChange={(e) => setPropRate(e.target.value)}
                    placeholder="Bps (e.g. 800)"
                    className="rounded border border-white/15 bg-white/[0.04] p-1.5 text-white"
                  />
                  <input
                    type="number"
                    value={propMonths}
                    onChange={(e) => setPropMonths(Number(e.target.value))}
                    placeholder="Months"
                    className="rounded border border-white/15 bg-white/[0.04] p-1.5 text-white"
                  />
                </div>
              </div>
            )}

            {/* Input Bar */}
            <div className="border-t border-white/10 pt-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowProposeCard(!showProposeCard)}
                  className={`rounded-lg border px-2.5 py-2 font-mono text-xs transition ${
                    showProposeCard ? "border-amber bg-amber/20 text-amber" : "border-white/15 text-white/60 hover:text-white"
                  }`}
                  title="Attach Loan Deal Terms"
                >
                  ⚡ Deal
                </button>
                <Input
                  value={newMsgText}
                  onChange={(e) => setNewMsgText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSend();
                  }}
                  placeholder="Type a message or discuss terms…"
                  className="flex-1 text-xs py-2 min-h-10"
                />
                <Button onClick={handleSend} className="px-4 py-2 text-xs">
                  Send
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-center font-mono text-xs text-white/40">
            Select a conversation partner above or click &quot;Message&quot; on any profile to begin negotiating.
          </div>
        )}
      </div>
    </div>
  );
}
