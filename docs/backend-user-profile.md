# Kullanıcı profili: backend gereksinimleri

Bu belge, API'nin oturum açmış kullanıcı için profil bilgisi ve arayüz içi canlı konum sağlaması için gereken backend işlerini tanımlar. Bu depoda API uygulaması bulunmadığından, aşağıdaki maddeler API deposunda uygulanmalıdır.

## İstenen davranış

- Kullanıcı, e-posta adresiyle giriş yapar. Görünen ad bilgisi doğrulanmış e-posta adresinin `@` öncesindeki yerel kısmından türetilir.
- Yerel kısım `.` karakterine göre parçalara ayrılır. İlk parça ad, kalan parçalar birleştirilerek soyad olur. Parçaların ilk harfi büyük gösterilir.
- Örnek: `serkan.taghan@sisal.com` → ad `Serkan`, soyad `Taghan`.
- Ad ve soyad, sunucuda saklanır ve kullanıcının kendi kimlik doğrulama yanıtlarıyla istemciye döndürülür. İstemciden gelen ad/soyad değerleri yetkili kaynak kabul edilmez.
- Kullanıcı üst sağdaki e-posta adresine tıkladığında açılan küçük panelde e-posta, ad, soyad ve profil avatarı görüntülenir. Ad ve e-posta düzenlenemez. Kullanıcı fotoğraf yükleyebilir/değiştirebilir/silebilir; fotoğraf yokken avatar rengini seçebilir.
- Çalışma alanında kullanıcıların o an görüntülediği collection, folder veya request aynı öğenin yanında ve seçili öğe başlığında gösterilir. Request URL'si, request gövdesi veya başka hassas içerik presence bilgisi olarak yayınlanmaz.

## API değişiklikleri

Mevcut frontend sözleşmesinde `POST /api/v1/auth/verify-code` ve `GET /api/v1/auth/me` yanıtları `{ user: { id, email } }` şeklindedir. Her iki yanıttaki kullanıcı nesnesi şu alanları sağlamalıdır:

```json
{
  "user": {
    "id": "user-id",
    "email": "serkan.taghan@sisal.com",
    "firstName": "Serkan",
    "lastName": "Taghan",
    "avatarUrl": null,
    "avatarColor": "violet"
  }
}
```

- `verify-code`, hem ilk kez oluşturulan kullanıcı hem de mevcut kullanıcı için kalıcı profil alanlarını döndürmelidir.
- `me`, oturum sahibinin güncel profil alanlarını döndürmelidir.
- Ad/soyad alanları yalnızca oturum sahibinin kullanıcı yanıtında sunulmalı; bu iş kapsamında başka kullanıcıların profilini sorgulayan genel bir endpoint açılmamalıdır.
- Mevcut kimlik doğrulama, oturum çerezi ve hata yanıtı davranışı değişmemelidir.
- `POST /api/v1/auth/me/avatar` (`multipart/form-data`, `avatar` alanı) kullanıcının profil fotoğrafını yüklemeli/değiştirmeli ve `{ "user": AuthUser }` döndürmelidir.
- `DELETE /api/v1/auth/me/avatar` fotoğrafı kaldırmalı ve güncel `{ "user": AuthUser }` döndürmelidir.
- `PATCH /api/v1/auth/me/profile` yalnızca izin verilen `avatarColor` alanını değiştirmeli ve güncel `{ "user": AuthUser }` döndürmelidir. Bu endpoint ad veya e-posta değişikliğine izin vermemelidir.
- Desteklenen avatar renkleri frontend ile sözleşmeli olmalıdır: `violet`, `blue`, `green`, `orange`, `rose`, `teal`.
- Kullanıcı fotoğrafı varken renk seçimi etkisizdir; fotoğraf silinince kayıtlı renkli avatar kullanılır. Renk tercihi kullanıcı profilinde kalıcı saklanır.

## Avatar yükleme ve saklama

- Yalnızca oturum açmış kullanıcının kendi fotoğrafını değiştirmesine izin verilmelidir.
- JPEG, PNG ve WebP kabul edilmeli; dosya boyutu en fazla 5 MiB olmalıdır. Sunucu hem gerçek dosya imzasını hem boyutu doğrulamalı; istemcinin `Content-Type` değerine güvenmemelidir.
- SVG ve çalıştırılabilir içerik kabul edilmemeli; dosya adı/gelen yol saklama anahtarı olarak kullanılmamalıdır. Yüklemeler güvenli nesne depolamada veya API'nin mevcut güvenli medya altyapısında tutulmalı ve erişim URL'si `avatarUrl` alanında verilmelidir.
- Upload değişiminde eski dosya yetim bırakılmamalı; silme endpoint'i depolanan görseli de temizlemeli. Depolama hataları kullanıcıya genel başarı yanıtı olarak gizlenmemelidir.
- Medya yanıtı görsel olarak sunulmalı ve hassas metadata mümkünse yükleme sırasında temizlenmelidir. Cache stratejisi, avatar değiştiğinde istemcinin eski resmi görmemesini sağlamalıdır (sürümlü URL veya uygun cache invalidation).

## Canlı konum / presence API'si

- Oturum doğrulamalı `PUT /api/v1/presence` endpoint'i, mevcut tarayıcı sekmesinin konum sinyalini yenilemelidir:

```json
{
  "clientId": "opaque-per-tab-id",
  "location": {
    "kind": "request",
    "collectionId": "collection-id",
    "itemId": "request-id"
  }
}
```

- `location` üç türden biri olmalıdır: collection için `{ "kind": "collection", "collectionId": "..." }`; folder veya request için `{ "kind": "folder|request", "collectionId": "...", "itemId": "..." }`. `location: null` sekmenin aktif konumunu temizlemelidir (ör. sekme gizlenince veya çalışma alanından ayrılınca).
- `clientId` istemcinin sekme başına ürettiği opak kimliktir; aynı kullanıcı birden fazla sekmede bulunabilir. Sunucu `(userId, clientId)` başına tek güncel konum tutmalı, tüm sekmeleri tek kayıt gibi ezmemelidir.
- İstemci 15 saniyede bir heartbeat yollar. Sunucu her heartbeat için en fazla 45 saniyelik TTL uygular; tarayıcı kapanması/çökmesi durumunda eski konumlar kendiliğinden düşer. Presence kalıcı geçmiş/denetim kaydı olarak saklanmamalıdır.
- Mevcut oturum doğrulamalı `GET /api/v1/events` SSE akışı `presence` adlı event göndermelidir. Yeni bağlantıda güncel tam snapshot, sonrasında her değişiklikte güncel tam snapshot yayınlanmalıdır:

```text
event: presence
data: {"users":[{"userId":"user-id","firstName":"Ayse","lastName":"Yilmaz","avatarUrl":null,"avatarColor":"green","location":{"kind":"request","collectionId":"collection-id","itemId":"request-id"}}]}
```

- Snapshot yalnızca aynı workspace'i görmeye yetkili aktif kullanıcıların konumlarını içermelidir. Her kayıtta kullanıcı kimliği, görünen ad/soyad ve avatar alanları ile izin verilen resource kimliği dışında veri bulunmamalıdır; e-posta, URL, request payload veya token yayınlanmamalıdır. Frontend mevcut kullanıcıyı kendi listesinde tekrar göstermemek üzere filtreler.
- Kaynağın silinmesi/çöpe taşınması, kullanıcının yetkisini kaybetmesi veya ilgili workspace'in kapsam dışına çıkması presence kaydını temizlemelidir. SSE bağlantısı kapanınca TTL temizliği yine çalışmalıdır.
- Bilinmeyen ya da başka workspace'e ait resource ID'leri doğrulanmalı ve reddedilmelidir; kullanıcılar arası kaynak/konum keşfine izin verilmemelidir.
- Presence için mevcut event geçmişini tüketmek gerekmez; yeni SSE bağlantısı güncel snapshot almalıdır. Presence event'leri mevcut `change`/`resync` olaylarının anlamını veya sıralamasını değiştirmemelidir.
- Sunucu aynı user'ın çoklu sekmelerindeki kayıtları birbirinden bağımsız tutmalı; snapshot'ta aynı kullanıcı aynı resource'ta birden fazla sekmeyle bulunuyorsa istemci görsel olarak kullanıcı başına tek avatar gösterebilir.

## Ad ve soyad türetme kuralları

1. E-posta yalnızca sunucuda doğrulanmış e-posta olmalıdır; gövde veya istemci tarafından gönderilen ad/soyad kullanılmamalıdır.
2. `@` öncesindeki kısım alınır ve `.` karakterine göre bölünür.
3. Boş parçalar atılır; ilk kalan parça `firstName`, geri kalan parçalar aralarında tek boşluk olacak şekilde `lastName` olur.
4. Parçaların başı/sonu boşluklardan arındırılır ve ilk harfleri büyük gösterilir. Geri kalan karakterlerin büyük/küçük harfi korunur; tüm parçayı küçük harfe çevirmek adların özgün yazımını bozabilir.
5. Soyadı olmayan adreslerde `lastName` boş metin olarak saklanabilir ve döndürülebilir. Boş yerel kısım gibi geçersiz e-posta durumları mevcut e-posta doğrulamasınca reddedilmelidir.

Örnekler:

| E-posta | Ad | Soyad |
|---|---|---|
| `serkan.taghan@sisal.com` | `Serkan` | `Taghan` |
| `ada.marie.lovelace@example.com` | `Ada` | `Marie Lovelace` |
| `serkan@sisal.com` | `Serkan` | `` |

## Veri tabanı ve migration

- Kullanıcı tablosuna kalıcı `first_name`, `last_name`, `avatar_url` ve `avatar_color` (veya projedeki adlandırma standardına uygun eşdeğer alanlar) eklenmelidir. Varsayılan avatar rengi geçerli palet değeri olmalıdır.
- **Daha önce kayıt yapmış olan kullanıcılar için migration hazırlanmalıdır.** Mevcut kullanıcıların ad ve soyadı e-posta yerel kısmından aynı kurallarla geriye dönük doldurulmalıdır.
- Migration avatar renk alanını geçerli bir varsayılanla doldurmalı; mevcut profil alanlarını ezmemelidir. Fotoğraf URL'si olmayan kullanıcı için avatar rengiyle initials gösterilir; fotoğraf migration ile uydurulmaz.
- Migration tekrarlanabilir/güvenli olmalı; mevcut dolu alanları ezmemeli. Geri alma stratejisi ve boş/alışılmadık yerel kısım değerlerinin nasıl ele alınacağı migration açıklamasında belirtilmelidir.
- Presence verisi geçicidir; kullanıcı/sekme/resource anahtarı TTL ile temizlenen cache veya projedeki eşdeğer ephemeral store'da tutulmalıdır, normal profil/resource tablosuna kalıcı aktivite geçmişi yazılmamalıdır.
- Şema değişikliği, uygulamanın beklediği API yanıtlarını üretmeye başlamasından önce dağıtılmalı; deployment sırası geriye uyumlu olmalıdır.

## Doğrulama ve testler

- İsim türetme birim testleri: tek parçalı yerel kısım, iki parçalı ad, birden fazla nokta, ardışık/kenar noktalar, boş soyadı ve büyük-küçük harf korunumu.
- İlk girişte kullanıcı oluşturma ve daha önce kayıtlı kullanıcının tekrar giriş akışları `firstName`/`lastName` değerlerini döndürmelidir.
- `GET /auth/me` değerleri kalıcı kayıttan dönmeli; istemcinin profil değerlerini değiştirmesine izin verilmemelidir.
- Avatar yükleme: oturum zorunluluğu, desteklenen görsel tipleri, bozuk dosya, 5 MiB sınırı, yetkisiz erişim, değiştir/sil ve depolama hataları test edilmelidir.
- Avatar rengi yalnızca desteklenen palet değerlerini kabul etmeli; ad/e-posta veya ek alan güncelleme girişimleri reddedilmelidir.
- Presence: clientId başına heartbeat yenileme, `null` konumla temizleme, TTL sona ermesi, çoklu sekmeler, SSE ilk snapshot ve güncelleme yayını, resource erişim doğrulaması, silme/taşıma temizliği test edilmelidir.
- Presence snapshot'ın request URL'si, başlıkları, gövdesi, token'ı veya kullanıcıya ait olmayan hassas çalışma verisi içermediği doğrulanmalıdır.
- Migration testi, mevcut kullanıcı kayıtlarını doğru doldurduğunu ve ikinci çalıştırmada mevcut değerleri değiştirmediğini doğrulamalıdır.
- API sözleşme testleri hem başarılı giriş hem de `me` yanıtlarında `id`, `email`, `firstName`, `lastName` alanlarını doğrulamalıdır.

## Kapsam dışı

- Ad/soyad güncelleme endpoint'i veya kullanıcıların birbirlerinin profillerini araması.
- E-posta yerel kısmından departman, unvan ya da tam yasal ad çıkarsama.
- Presence'ın geçmişini/analitiğini tutma.
