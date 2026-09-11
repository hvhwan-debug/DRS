<script>
    // Kho chứa danh sách ảnh thuần Việt lấy trực tiếp từ thư mục trên GitHub của bạn
    // (Bạn có thể đổi tên file theo đúng các ảnh thực tế bạn đã upload lên thư mục images/)
    const repoImagesPool = [
      "images/vung-cao-1.jpg",
      "images/lop-hoc-2.jpg",
      "images/thien-nguyen-3.jpg",
      "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=600&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1577896851231-70ef18881754?w=600&auto=format&fit=crop&q=80"
    ];

    function getRandomRepoImage() {
      const randomIndex = Math.floor(Math.random() * repoImagesPool.length);
      return repoImagesPool[randomIndex];
    }

    function openModal() { document.getElementById('donateModal').style.display = 'flex'; }
    function closeModal() { document.getElementById('donateModal').style.display = 'none'; }
    window.onclick = function(event) {
      let modal = document.getElementById('donateModal');
      if (event.target == modal) { modal.style.display = 'none'; }
    }

    function toggleMobileMenu() {
      const navLinks = document.getElementById('navLinks');
      const menuBtn = document.getElementById('menuBtn');
      navLinks.classList.toggle('active');
      if (navLinks.classList.contains('active')) {
        menuBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      } else {
        menuBtn.innerHTML = '<i class="fa-solid fa-bars"></i>';
      }
    }

    async function loadArticle() {
      const urlParams = new URLSearchParams(window.location.search);
      const postFile = urlParams.get('post');
      const card = document.getElementById('articleContent');

      if (!postFile) {
        card.innerHTML = `<h2>Không tìm thấy bài viết</h2><p>Đường dẫn không hợp lệ.</p>`;
        return;
      }

      const repo = 'hvhwan-debug/DRS';
      const fileURL = `https://raw.githubusercontent.com/${repo}/main/content/posts/${postFile}`;

      try {
        const res = await fetch(fileURL);
        if (!res.ok) throw new Error('Không tải được file bài viết');
        const text = await res.text();

        const parts = text.split('---');
        let title = 'Bài viết chi tiết';
        let date = '2026';
        let thumbnail = '';
        let markdownBody = text;

        if (parts.length >= 3) {
          const yamlMeta = parts[1];
          const titleMatch = yamlMeta.match(/title:\s*"?(.*?)"?$/m);
          const dateMatch = yamlMeta.match(/date:\s*"?(.*?)"?$/m);
          const thumbMatch = yamlMeta.match(/thumbnail:\s*"?(.*?)"?$/m);

          if (titleMatch) title = titleMatch[1].replace(/["']/g, '');
          if (dateMatch) date = dateMatch[1].replace(/["']/g, '');
          if (thumbMatch) thumbnail = thumbMatch[1].replace(/["']/g, '');

          markdownBody = parts.slice(2).join('---').trim();
        }

        // QUAN TRỌNG: Nếu bài viết không có thumbnail hoặc để trống, tự động bốc ngẫu nhiên 1 ảnh từ kho của bạn!
        let finalThumb = (thumbnail && thumbnail.trim() !== "") ? thumbnail : getRandomRepoImage();

        let htmlBody = markdownBody
          .replace(/^### (.*$)/gm, '<h3>$1</h3>')
          .replace(/^## (.*$)/gm, '<h2>$1</h2>')
          .replace(/^- (.*$)/gm, '<li>$1</li>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .split('\n\n').map(p => p.startsWith('<h') || p.startsWith('<li') ? p : `<p>${p}</p>`).join('');

        card.innerHTML = `
          <div class="article-date"><i class="fa-regular fa-calendar"></i> ${date}</div>
          <h1 class="article-title">${title}</h1>
          ${finalThumb ? `<img src="${finalThumb}" alt="${title}" class="article-thumb">` : ''}
          <div class="article-body">${htmlBody}</div>
        `;
      } catch (err) {
        card.innerHTML = `<h2>Lỗi tải bài viết</h2><p>Không thể kết nối đến kho lưu trữ hoặc file bài viết không tồn tại.</p>`;
      }
    }

    loadArticle();
  </script>
