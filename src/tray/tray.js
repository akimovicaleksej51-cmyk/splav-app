const $ = id => document.getElementById(id);
const css = u => u ? `url("${String(u).replace(/"/g, '%22')}")` : '';
window.tray.onNp(d => {
  const has = !!(d && d.title);
  $('empty').hidden = has; $('cover').hidden = !has; $('meta').hidden = !has; $('ctrl').hidden = !has;
  if (!has) return;
  $('cover').style.backgroundImage = css(d.cover);
  $('title').textContent = d.title; $('artist').textContent = d.artist || '';
  $('lyric').textContent = d.lyric || (d.hasLyrics === false ? '' : '');
  $('lyric').classList.toggle('dim', !d.lyric);
  $('play').classList.toggle('playing', !!d.playing);
  $('like').classList.toggle('on', !!d.liked);
  $('like').style.visibility = d.canLike ? 'visible' : 'hidden';
  if (d.color) document.querySelector('.glow').style.setProperty('--c', d.color.join(','));
});
['prev', 'next', 'like', 'open'].forEach(id => $(id).addEventListener('click', () => window.tray.cmd(id)));
$('play').addEventListener('click', () => window.tray.cmd('toggle'));
$('cover').addEventListener('click', () => window.tray.cmd('open'));
