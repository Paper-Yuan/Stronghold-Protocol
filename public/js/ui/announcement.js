import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';
import { html, Icon, Modal, Button, MicroLabel } from './components.js';
import { useStore, selectRoute } from '../store.js';
import { t } from '../../shared/i18n.js';

const SEEN_ANNOUNCEMENT_ID_KEY = 'sp.announcement.last_seen_id';

export function AnnouncementBanner() {
  const route = useStore(selectRoute);
  const liveNotice = useStore((s) => s.announcement);
  const [closed, setClosed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const lastNoticeIdRef = useRef(null);

  // 判断当前客户端平台
  const isAndroid = Boolean(globalThis.AndroidNative?.isNativeApp?.() || /Android/i.test(navigator.userAgent));
  const isWeb = !isAndroid;

  // 判断客户端是否匹配公告定向目标
  const isTargetMatched = (() => {
    if (!liveNotice) return true;
    const targetPlat = liveNotice.platform || 'all';
    if (targetPlat === 'android' && !isAndroid) return false;
    if (targetPlat === 'web' && !isWeb) return false;

    const targetScene = liveNotice.scene || 'all';
    const inMatch = route === 'game';
    if (targetScene === 'lobby' && inMatch) return false;
    if (targetScene === 'match' && !inMatch) return false;

    return true;
  })();

  // 当后台发布了新公告（ID 变化且存在，且符合目标定向）时，自动重置关闭状态并主动弹窗提示
  useEffect(() => {
    if (liveNotice && liveNotice.id && isTargetMatched) {
      if (lastNoticeIdRef.current !== liveNotice.id) {
        lastNoticeIdRef.current = liveNotice.id;
        const seenId = localStorage.getItem(SEEN_ANNOUNCEMENT_ID_KEY);
        if (seenId !== liveNotice.id) {
          setClosed(false);
          setModalOpen(true);
        }
      }
    }
  }, [liveNotice, isTargetMatched]);

  // 仅在存在有效动态公告且匹配定向时展示
  const isLive = Boolean(liveNotice && liveNotice.text && isTargetMatched);
  if (!isLive) return null;

  const text = liveNotice.text;
  const level = liveNotice.level || 'info';
  const levelLabel = level === 'urgent' ? t('紧急广播') : level === 'warning' ? t('系统提醒') : t('全服公告');
  const levelColor = level === 'urgent' ? '#ff5b5b' : level === 'warning' ? '#ffb84d' : '#51d8b3';
  const levelBorder = level === 'urgent' ? 'rgba(255,91,91,0.3)' : level === 'warning' ? 'rgba(255,184,77,0.3)' : 'rgba(81,216,179,0.3)';

  // 横幅展示规则：未手动关闭，且位于主界面/大厅，或者对局中收到紧急提醒
  const inMatch = route === 'game';
  const showInMatch = inMatch && (liveNotice.scene === 'match' || liveNotice.level === 'urgent');
  const shouldShowBanner = !closed && ((route === 'title' || route === 'lobby') || showInMatch);

  const targetUrl = liveNotice?.targetUrl || null;

  const dismissModal = () => {
    setModalOpen(false);
    try {
      if (liveNotice?.id) {
        localStorage.setItem(SEEN_ANNOUNCEMENT_ID_KEY, liveNotice.id);
      }
    } catch {}
  };

  return html`
    ${shouldShowBanner ? html`
      <aside class="site-notice site-notice--${level}" role="status" style="cursor:pointer; border-color:${levelBorder};" onClick=${() => setModalOpen(true)}>
        <span class="site-notice__label" style="background:${levelColor}; color:#0a120e;">${levelLabel}</span>
        <span class="site-notice__accessible">${text}</span>
        <div class="site-notice__viewport" aria-hidden="true">
          <span class="site-notice__text" style="animation: none; transform: none; color:${levelColor}; font-weight:500;">
            ${text}
          </span>
        </div>
        <button type="button" class="site-notice__close" aria-label="关闭通知" title="关闭通知" onClick=${(e) => { e.stopPropagation(); setClosed(true); }}>
          <${Icon} name="close" />
        <//>
      </aside>
    ` : null}

    <${Modal}
      open=${modalOpen}
      tone=${level === 'urgent' ? 'red' : level === 'warning' ? 'amber' : 'mint'}
      micro="ALLIANCE BROADCAST // 卫戍协议盟约系统公告"
      title=${levelLabel}
      onClose=${dismissModal}
      width="min(6.4rem, 92vw)"
      actions=${html`
        ${targetUrl ? html`
          <${Button} variant="secondary" icon="external" onClick=${() => { window.open(targetUrl, '_blank'); }}>
            ${t('查看详情 / 下载')}
          <//>
        ` : null}
        <${Button} variant="primary" icon="check" onClick=${dismissModal}>
          ${t('我知道了')}
        <//>
      `}>
      <div style="display:flex; flex-direction:column; gap:.14rem; font-size:max(.14rem, 13px); line-height:1.7; color:var(--text-md, #c5cac5);">
        <div style="border-left:3px solid ${levelColor}; padding:.12rem .16rem; background:rgba(0,0,0,0.25); border-radius:4px;">
          <div style="font-weight:700; color:${levelColor}; font-size:max(.15rem, 14px); margin-bottom:.06rem;">
            📢 ${levelLabel}：
          </div>
          <div style="white-space:pre-wrap; word-break:break-word; color:var(--text-hi, #fff); font-size:max(.15rem, 14px); line-height:1.8;">
            ${liveNotice.text}
          </div>
        </div>
        ${liveNotice.endAt ? html`
          <div style="font-size:max(.12rem, 11px); color:var(--text-sub, #7e8781);">
            有效时间至：${new Date(liveNotice.endAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
          </div>
        ` : null}
        <div style="font-size:max(.12rem, 11px); color:var(--text-sub, #7e8781); margin-top:.06rem; border-top:1px solid rgba(255,255,255,0.08); padding-top:.1rem; display:flex; justify-content:space-between;">
          <span>罗德岛战术网络调度组</span>
          <span>Stronghold Protocol: Alliance</span>
        </div>
      </div>
    <//>
  `;
}
