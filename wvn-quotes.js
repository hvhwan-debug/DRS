/*
 * Câu triết lý song ngữ (Việt – Anh) dùng chung cho mọi giao diện Tri thức Việt.
 *   WVNQuote.html('team')   -> khối <blockquote> cho đội ngũ (Quản trị, Công Việc, CRM, Đăng nhập)
 *   WVNQuote.html('family') -> khối cho phụ huynh / thành viên (Khu thành viên, trang Xác nhận)
 *   WVNQuote.mount(el, set) -> chèn khối vào cuối phần tử el
 * Mỗi lần mở trang chọn ngẫu nhiên 1 câu, không lặp lại câu vừa xem; trong cùng 1 lần mở trang
 * câu được giữ nguyên dù giao diện vẽ lại nhiều lần.
 */
(function () {
  'use strict';
  var SHARED = [
    ['Điều các em nhớ không phải con số, mà là cảm giác có người đã tin mình.', 'Children do not remember the numbers. They remember that someone believed in them.'],
    ['Giáo dục không đổ đầy một chiếc bình, mà thắp lên một ngọn lửa.', 'Education is not filling a pail, but lighting a fire.'],
    ['Gieo một hạt chữ hôm nay, gặt một đời người mai sau.', 'Plant a seed of learning today, harvest a whole life tomorrow.'],
    ['Kiên nhẫn là món quà lớn nhất ta trao cho một người đang học.', 'Patience is the greatest gift we can give to someone learning.'],
    ['Một đứa trẻ, một người thầy, một cuốn sách có thể thay đổi cả thế giới.', 'One child, one teacher, one book can change the world.'],
    ['Không ai giỏi một mình; ta giỏi lên vì có nhau.', 'No one grows alone; we grow because we have each other.'],
    ['Mỗi em nhỏ là một câu chuyện chưa được kể hết.', 'Every child is a story not yet fully told.'],
    ['Kiến tạo giá trị, vượt thời gian.', 'Creating value that outlasts time.']
  ];
  var SETS = {
    team: SHARED.concat([
      ['Mỗi đơn đăng ký được xử lý hôm nay là một em nhỏ được đến lớp sớm hơn một ngày.', 'Every form handled today brings a child to class one day sooner.'],
      ['Sổ sách rõ ràng là cách chúng ta giữ lời hứa với từng nhà hảo tâm.', 'Clear books are how we keep our promise to every donor.'],
      ['Một cuộc gọi hỏi thăm đúng lúc có thể giữ một em ở lại lớp học.', 'One timely call can keep a child in the classroom.'],
      ['Việc nhỏ làm đều tay mỗi ngày sẽ thành con đường đến trường.', 'Small things done well, day after day, become a road to school.'],
      ['Hôm nay, hãy làm một việc khó trở nên dễ hơn cho người đến sau.', 'Today, make one hard thing easier for whoever comes next.'],
      ['Minh bạch từng đồng, tận tâm từng em.', 'Transparent with every coin, devoted to every child.'],
      ['Chậm mà chắc vẫn hơn nhanh mà sai.', 'Slow and sure beats fast and wrong.'],
      ['Người ta không nhớ bạn làm nhiều bao nhiêu, mà nhớ bạn làm tử tế thế nào.', 'People forget how much you did, but remember how kindly you did it.'],
      ['Cho đi đúng cách cũng quan trọng như cho đi.', 'Giving well matters as much as giving.'],
      ['Điều đúng đắn hiếm khi dễ, nhưng luôn đáng làm.', 'The right thing is rarely easy, but always worth doing.'],
      ['Sự tin cậy được xây bằng từng lời hứa nhỏ được giữ.', 'Trust is built from small promises kept.'],
      ['Làm việc tận tâm là cách lặng lẽ nhất để nói lời yêu thương.', 'Working with care is the quietest way to say I love you.'],
      ['Hãy làm việc hôm nay như thể một em nhỏ đang nhìn theo.', 'Work today as if a child were watching.']
    ]),
    family: SHARED.concat([
      ['Mỗi ngày con học thêm một điều nhỏ, là mỗi ngày con lớn thêm một chút.', 'Every small thing a child learns today helps them grow a little more.'],
      ['Cha mẹ là người thầy đầu tiên và lâu dài nhất của con.', 'Parents are a child\u2019s first and longest-lasting teachers.'],
      ['Chữ đẹp bắt đầu từ nét chậm, người tốt bắt đầu từ điều nhỏ.', 'Beautiful handwriting starts with slow strokes; good character starts with small deeds.'],
      ['Một lời khen đúng lúc có thể thắp sáng cả một năm học.', 'One timely word of praise can light up a whole school year.'],
      ['Đừng so con với ai, hãy so con hôm nay với con hôm qua.', 'Compare your child only with who they were yesterday.'],
      ['Học không phải để giỏi hơn người khác, mà để tốt hơn chính mình.', 'We learn not to be better than others, but to be better than ourselves.'],
      ['Mỗi đóng góp của bạn là một viên gạch trên con đường đến trường của các em.', 'Every contribution you make is a brick on a child\u2019s road to school.'],
      ['Đọc cùng con mười phút mỗi ngày, con nhớ mãi cả đời.', 'Ten minutes of reading together each day is remembered for a lifetime.'],
      ['Tò mò là khởi đầu của mọi hiểu biết.', 'Curiosity is where all understanding begins.'],
      ['Sai là một phần của việc học, không phải là thất bại.', 'Mistakes are part of learning, not a failure.'],
      ['Hãy để con được hỏi "tại sao" nhiều hơn là nghe "phải thế".', 'Let children ask "why" more often than they hear "because I said so".'],
      ['Điều quý nhất cha mẹ trao cho con là thời gian ở bên con.', 'The most precious thing parents give is time spent together.']
    ])
  };
  var chosen = {};
  function pick(set) {
    set = SETS[set] ? set : 'team';
    if (chosen[set]) return chosen[set];
    var list = SETS[set], key = 'wvn_last_quote_' + set, last = -1;
    try { last = parseInt(localStorage.getItem(key) || '-1', 10); } catch (e) {}
    var i = Math.floor(Math.random() * list.length);
    if (i === last && list.length > 1) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
    try { localStorage.setItem(key, String(i)); } catch (e) {}
    chosen[set] = list[i];
    return chosen[set];
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function html(set, extraClass) {
    var q = pick(set);
    return '<blockquote class="wvn-quote' + (extraClass ? ' ' + extraClass : '') + '"><p>' + esc(q[0]) + '</p><p class="wvn-quote-en" lang="en">' + esc(q[1]) + '</p></blockquote>';
  }
  function mount(el, set, extraClass) {
    if (!el) return;
    var old = el.querySelector(':scope > .wvn-quote'); if (old) old.remove();
    el.insertAdjacentHTML('beforeend', html(set, extraClass));
  }
  window.WVNQuote = { pick: pick, html: html, mount: mount, sets: SETS };
})();
