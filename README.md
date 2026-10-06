# Web Performans & UX Teşhis Platformu v2.0

Staj Projesi 05. Sayfanın açılış hızını, yerleşim kararlılığını, tıklama gecikmesini ve yazma davranışını tarayıcının kendi API’leriyle ölçen, tamamen istemci tarafında çalışan bir teşhis ekranı.

Harici kütüphane veya CDN yoktur. Ölçüm, kodun çalıştığı sayfanın kendisine aittir. Başka bir sitenin adresi buradan okunamaz; sol taraftaki senaryolar farklı sayfa türlerinin yerine geçer.

## Çalıştırma

`index.html` dosyasını tarayıcıda açmak yeterlidir. İstersen proje klasöründe küçük bir sunucu da kullanabilirsin:

```bash
python -m http.server 8765
```

Ardından [http://127.0.0.1:8765/](http://127.0.0.1:8765/) adresine gir.

## Sol taraf

Senaryo, ölçülen sayfayı değiştirir:

| Senaryo | Ne olur |
| --- | --- |
| Sade sayfa | Yalnızca yazım ve tıklama ölçülür |
| Ürün vitrini | Arama yazım hızına, sepete ekleme tıklama günlüğüne girer |
| Ağır katalog | Yaklaşık 2.300 düğüm ve derin bir ağaç eklenir |
| Kaymalı yerleşim | Düğmeden 0,7 sn sonra açılan bant içeriği aşağı iter ve CLS artar |
| Yavaş işlem | Tıklama ana iş parçacığını yaklaşık 320 ms kilitler; INP ve uzun görev oluşur |

Yazım profili (Ad, E-posta, Geri Bildirim) tuş basılı tutma süresini, tuşlar arası gecikmeyi, WPM, CPS, silme oranını ve odaklanma süresini hesaplar. Tıklamalar tuval üzerinde ısı noktası olarak birikir.

**Örnek Simülasyon Çalıştır** aynı ölçüm kodundan yazma, tıklama ve küçük bir kayma üretir. **Metrikleri Sıfırla** oturum verisini temizler. LCP ve gezinme süreleri sayfa yenilenmeden tekrar ölçülemediği için korunur.

## Sağ taraf

- **Teşhis:** 100 üzerinden oturum notu ve kısa yorum. **Referans al**, DOM ve CLS değerini saklar; senaryo değişince farkı yazar.
- **Core Web Vitals:** LCP, INP, CLS ve FCP. Yeşil iyi, sarı geliştirilmeli, kırmızı zayıf.
- **Sistem ve DOM:** düğüm sayısı, maksimum ağaç derinliği, JS heap (`performance.memory`), TTFB, DOMContentLoaded, Load, uzun görev ve kaynak sayısı.
- **Etkileşim:** WPM, CPS, hata/silme oranı, odaklanma süresi, ortalama tuş basılı tutma ve tuşlar arası gecikme.
- **Canlı log:** zaman, olay tipi, hedef eleman, gecikme.
- **JSON İndir / CSV İndir:** anlık ölçümü `Blob` ile dosyaya çevirir.

Eşikler: LCP 2,5 sn / 4 sn, INP 200 ms / 500 ms, CLS 0,10 / 0,25, FCP 1,8 sn / 3 sn.

## Dosyalar

```text
index.html
css/style.css
js/app.js
```

`js/app.js` içinde `PerformanceObserver` şu türleri dinler: `largest-contentful-paint`, `first-input`, `layout-shift`, `event`, `navigation`, `longtask`. DOM derinliği özyinelemeli hesaplanır. Klavye ölçümü `keydown` ve `keyup` arasındaki milisaniye farkına dayanır.
