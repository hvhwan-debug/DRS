// Service Worker cho thông báo đẩy của trang Công Việc (admin.wvn.vn). Chỉ xử lý sự kiện push/click,
// không cache gì cả (không phải PWA offline, chỉ để nhận thông báo nền khi tab không mở).
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Công Việc · Tri thức Việt';
  const options = {
    body: data.body || '',
    icon: '/images/favicon-32x32.png',
    badge: '/images/favicon-32x32.png',
    data: { url: data.url || '/admin/cong-viec' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/admin/cong-viec';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
