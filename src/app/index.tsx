import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, TextInput, ScrollView, TouchableOpacity, Keyboard, StatusBar, ActivityIndicator, Animated, RefreshControl, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

const TURKISH_CITIES = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Amasya", "Ankara", "Antalya", "Artvin", "Aydın", "Balıkesir",
  "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum", "Denizli",
  "Diyarbakır", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir", "Gaziantep", "Giresun", "Gümüşhane", "Hakkari",
  "Hatay", "Isparta", "Mersin", "İstanbul", "İzmir", "Kars", "Kastamonu", "Kayseri", "Kırklareli", "Kırşehir",
  "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa", "Kahramanmaraş", "Mardin", "Muğla", "Muş", "Nevşehir",
  "Niğde", "Ordu", "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas", "Tekirdağ", "Tokat",
  "Trabzon", "Tunceli", "Şanlıurfa", "Uşak", "Van", "Yozgat", "Zonguldak", "Aksaray", "Bayburt", "Karaman",
  "Kırıkkale", "Batman", "Şırnak", "Bartın", "Ardahan", "Iğdır", "Yalova", "Karabük", "Kilis", "Osmaniye", "Düzce"
];

const getBackgroundGradient = (condition: string): readonly [string, string] => {
  switch(condition) {
    case 'Clear': return ['#2980B9', '#6DD5FA']; 
    case 'Rain': case 'Drizzle': case 'Thunderstorm': return ['#2b5876', '#4e4376']; 
    case 'Clouds': return ['#757F9A', '#D7DDE8'];
    case 'Snow': return ['#E0EAFC', '#CFDEF3'];
    default: return ['#2980B9', '#6DD5FA'];
  }
};

const getIconColor = (condition: string) => {
  switch(condition) {
    case 'Clear': return '#FFC312'; 
    case 'Rain': case 'Drizzle': case 'Thunderstorm': return '#74B9FF'; 
    case 'Clouds': return '#DFE6E9'; 
    case 'Snow': return '#FFFFFF'; 
    default: return '#FFC312';
  }
};

const getFallbackAdvice = (temp: number, condition: string) => {
  if (condition === 'Rain' || condition === 'Drizzle') return "Şemsiyenizi almayı ve su geçirmez giyinmeyi unutmayın.";
  if (condition === 'Thunderstorm') return "Dışarıda fırtına var, güvende kalın ve dikkatli olun.";
  if (condition === 'Snow') return "Kar yağışlı ve soğuk bir gün, sıkı giyinmeniz önerilir.";
  if (temp >= 25) return "Hava sıcaklığı yüksek, ince ve rahat kıyafetler tercih edebilirsiniz.";
  if (temp >= 15) return "Hafif serin bir hava, yanınıza ince bir ceket alabilirsiniz.";
  return "Hava soğuk, dışarı çıkarken kalın giyinmeniz tavsiye edilir.";
};

const fetchAIAdvice = async (cityName: string, temp: number, feels: number, wind: number, desc: string) => {
  const currentHour = new Date().getHours();
  const cacheKey = `ai_advice_v3_${cityName.replace(/\s/g, '')}_${temp}_${desc.replace(/\s/g, '')}_h${currentHour}`;
  
  try {
    const cachedAdvice = await AsyncStorage.getItem(cacheKey);
    if (cachedAdvice !== null) return cachedAdvice;
  } catch (e) {}

  const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return getFallbackAdvice(temp, desc);
  }
  
  try {
    const prompt = `Sen sadece Türkçe konuşan bir hava durumu asistanısın.
Şehir: ${cityName}
Sıcaklık: ${temp}°C
Durum: ${desc}

KURALLAR:
1. SADECE Türkçe konuş. "Location", "City", "Current" gibi İngilizce kelimeler KESİNLİKLE kullanma.
2. Maksimum 15 kelimeyle dışarı çıkacak birine ne giymesi gerektiğini söyle.
3. Sadece doğrudan tavsiyeyi yaz.
4. Kesinlikle hiçbir emoji kullanma.`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 100 }
      })
    });
    
    if (!res.ok) {
      return getFallbackAdvice(temp, desc);
    }

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return getFallbackAdvice(temp, desc);
    }

    let advice = rawText.trim();
    advice = advice.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '').trim();
    
    await AsyncStorage.setItem(cacheKey, advice).catch(() => {});
    return advice;
  } catch (e) {
    return getFallbackAdvice(temp, desc);
  }
};

const getImportantEvent = (hourly: any[]) => {
  const rainHour = hourly.find(h => h.condition === 'Rain' || h.condition === 'Thunderstorm' || h.condition === 'Drizzle');
  if (rainHour) return `Dikkat: Saat ${rainHour.time} civarı yağış bekleniyor. Şemsiyesiz çıkmayın.`;
  
  const temps = hourly.map(h => h.temp);
  const maxT = Math.max(...temps);
  const minT = Math.min(...temps);
  
  if (maxT - minT >= 7) return `Sıcaklık gün içinde dalgalı (${minT}°C - ${maxT}°C). Katmanlı giyinmeniz önerilir.`;
  if (maxT > 30) return `Öğleden sonra hava aşırı sıcak olacak. Güneşten korunmaya dikkat edin.`;
  if (minT < 5) return `Akşama doğru hava oldukça soğuyacak, kalın giysiler tercih edin.`;
  
  return `Bugün hava genel olarak stabil ve sakin.`;
};

const calculateWeatherScore = (temp: number, wind: number, condition: string) => {
  let score = 100;
  const tempPenalty = Math.abs(22 - temp) * 1.5;
  score -= tempPenalty;
  score -= (wind * 0.5);
  
  if (['Rain', 'Drizzle'].includes(condition)) score -= 25;
  if (['Thunderstorm'].includes(condition)) score -= 40;
  if (['Snow'].includes(condition)) score -= 15;
  if (['Clouds'].includes(condition)) score -= 5;
  
  return Math.max(0, Math.round(score));
};

const getComfortText = (temp: number, hum: number) => {
  if (temp > 28 && hum > 60) return "Bunalatıcı";
  if (temp > 25) return "Sıcak";
  if (temp >= 18 && temp <= 25) return "İdeal Rahatlık";
  if (temp >= 10 && temp < 18) return "Serin";
  return "Soğuk";
};

const formatTime = (unixTime: number) => {
  const d = new Date(unixTime * 1000);
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
};

const getTempGradient = (min: number, max: number): readonly [string, string] => {
  let startColor = '#81ecec';
  let endColor = '#fab1a0';

  if (min <= 5) startColor = '#74b9ff';
  else if (min <= 15) startColor = '#55efc4';
  else startColor = '#ffeaa7';

  if (max >= 30) endColor = '#ff7675';
  else if (max >= 22) endColor = '#fab1a0';
  else endColor = '#ffeaa7';

  return [startColor, endColor];
};

const WeatherScreen = React.memo(({ pageData, index, onRemove, isPreview, scrollX, refreshing, onRefresh }: any) => {
  const { width } = useWindowDimensions();
  const [aiText, setAiText] = useState("Asistan analiz ediyor...");

  useEffect(() => {
    let isMounted = true;
    const getAdvice = async () => {
      const text = await fetchAIAdvice(pageData.name, pageData.temp, pageData.feels, pageData.windSpeed, pageData.desc);
      if (isMounted) setAiText(text);
    };
    getAdvice();
    return () => { isMounted = false; };
  }, [pageData.name, pageData.temp, pageData.desc]);

  const importantEvent = getImportantEvent(pageData.hourly);
  const weatherScore = calculateWeatherScore(pageData.temp, pageData.windSpeed, pageData.condition);
  const comfortText = getComfortText(pageData.temp, pageData.hum);

  let animatedStyle = {};
  if (scrollX && index !== undefined) {
    const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
    const opacity = scrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });
    const scale = scrollX.interpolate({ inputRange, outputRange: [0.85, 1, 0.85], extrapolate: 'clamp' });
    const translateY = scrollX.interpolate({ inputRange, outputRange: [30, 0, 30], extrapolate: 'clamp' });
    animatedStyle = { opacity, transform: [{ scale }, { translateY }] };
  }

  return (
    <ScrollView 
      showsVerticalScrollIndicator={false} 
      style={{ width }} 
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
    >
      <Animated.View style={animatedStyle}>
        
        <View style={styles.heroSection}>
          <View style={styles.heroHeader}>
            <Text style={styles.cityHugeText} numberOfLines={1} adjustsFontSizeToFit>{pageData.name}</Text>
            {!isPreview && !pageData.name.includes('KONUMUM') && onRemove && index !== undefined && (
              <TouchableOpacity onPress={() => onRemove(index)} style={styles.removeButton}>
                <Ionicons name="trash-outline" size={26} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.descTextCenter}>{pageData.temp}° | {pageData.desc}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}><Ionicons name="sparkles" size={13} color="rgba(255,255,255,0.6)" />  YAPAY ZEKA ASİSTANI</Text>
          <Text style={styles.adviceText}>{aiText}</Text>
        </View>

        <View style={[styles.card, styles.highlightCard]}>
          <Text style={styles.sectionTitle}><Ionicons name="alert-circle-outline" size={14} color="rgba(255,255,255,0.6)" />  GÜNÜN ÖZETİ</Text>
          <Text style={styles.importantEventText}>{importantEvent}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}><Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.6)"/>  SAATLİK TAHMİN</Text>
          <View style={styles.cardDivider} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {pageData.hourly.map((item: any, idx: number) => (
              <View key={idx} style={styles.hourlyItem}>
                <Text style={styles.hourlyTime}>{item.time}</Text>
                <Ionicons name={item.icon as any} size={28} color={getIconColor(item.condition)} style={styles.hourlyIcon} />
                <Text style={styles.hourlyTemp}>{item.temp}°</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}><Ionicons name="calendar-outline" size={14} color="rgba(255,255,255,0.6)"/>  5 GÜNLÜK TAHMİN</Text>
          <View style={styles.cardDivider} />
          {pageData.daily.map((item: any, idx: number) => (
            <View key={idx} style={[styles.dailyRow, idx === pageData.daily.length - 1 && styles.noBorderBottom]}>
              <Text style={styles.dailyDay}>{item.day}</Text>
              <Ionicons name={item.icon as any} size={24} color={getIconColor(item.condition)} style={styles.dailyIcon} />
              <View style={styles.dailyTempRange}>
                <Text style={styles.dailyMin}>{item.min}°</Text>
                <View style={styles.tempBarBackground}>
                   <LinearGradient
                     colors={getTempGradient(item.min, item.max)}
                     start={{ x: 0, y: 0.5 }}
                     end={{ x: 1, y: 0.5 }}
                     style={styles.tempBarFill}
                   />
                </View>
                <Text style={styles.dailyMax}>{item.max}°</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.rowContainer}>
          <View style={[styles.card, styles.flexCard, styles.marginRightCard]}>
             <Text style={styles.sectionTitle}><Ionicons name="analytics-outline" size={14} color="rgba(255,255,255,0.6)"/>  HAVA SKORU</Text>
             <Text style={styles.scoreText}>{weatherScore}<Text style={styles.scoreSubtext}>/100</Text></Text>
          </View>
          
          <View style={[styles.card, styles.flexCard, styles.marginLeftCard]}>
             <Text style={styles.sectionTitle}><Ionicons name="body-outline" size={14} color="rgba(255,255,255,0.6)"/>  KONFOR</Text>
             <Text style={styles.comfortText}>{comfortText}</Text>
          </View>
        </View>

        <View style={styles.rowContainer}>
          <View style={[styles.card, styles.flexCard, styles.marginRightCard]}>
             <Text style={styles.sectionTitle}><Ionicons name="compass-outline" size={14} color="rgba(255,255,255,0.6)"/>  RÜZGAR</Text>
             <View style={styles.windContainer}>
               <Ionicons name="navigate" size={32} color="#fff" style={{ transform: [{ rotate: `${pageData.windDeg}deg` }] }} />
             </View>
             <Text style={styles.windText}>{pageData.windSpeed} km/h</Text>
          </View>
          
          <View style={[styles.card, styles.flexCard, styles.marginLeftCard]}>
             <Text style={styles.sectionTitle}><Ionicons name="leaf-outline" size={14} color="rgba(255,255,255,0.6)"/>  KALİTE</Text>
             <Text style={[styles.aqiText, { color: pageData.aqiColor }]}>{pageData.aqiText}</Text>
             <Text style={styles.aqiSubtext}>İndeks: {pageData.aqiIndex}/5</Text>
          </View>
        </View>

        <View style={styles.rowContainerBottom}>
          <View style={[styles.card, styles.flexCard, styles.marginRightCard]}>
             <Text style={styles.sectionTitle}><Ionicons name="sunny-outline" size={14} color="rgba(255,255,255,0.6)"/> DOĞUŞ</Text>
             <Text style={styles.sunText}>{pageData.sunrise}</Text>
          </View>
          
          <View style={[styles.card, styles.flexCard, styles.marginLeftCard]}>
             <Text style={styles.sectionTitle}><Ionicons name="moon-outline" size={14} color="rgba(255,255,255,0.6)"/> BATIŞ</Text>
             <Text style={styles.sunText}>{pageData.sunset}</Text>
          </View>
        </View>

      </Animated.View>
    </ScrollView>
  );
});

export default function WeatherApp() {
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredCities, setFilteredCities] = useState<string[]>([]);
  const [isDropdownVisible, setIsDropdownVisible] = useState(false);

  const [weatherPages, setWeatherPages] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  
  const [previewData, setPreviewData] = useState<any>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const mapConditionToIcon = (main: string) => {
    switch(main) {
      case 'Clear': return 'sunny';
      case 'Rain': case 'Drizzle': return 'rainy';
      case 'Thunderstorm': return 'thunderstorm';
      case 'Snow': return 'snow';
      case 'Clouds': return 'cloudy';
      default: return 'partly-sunny';
    }
  };

  const getAqiDetails = (aqi: number) => {
    switch(aqi) {
      case 1: return { text: "Çok İyi", color: "#55efc4" };
      case 2: return { text: "İyi", color: "#81ecec" };
      case 3: return { text: "Orta", color: "#ffeaa7" };
      case 4: return { text: "Kötü", color: "#fab1a0" };
      case 5: return { text: "Tehlikeli", color: "#ff7675" };
      default: return { text: "Bilinmiyor", color: "#fff" };
    }
  };

  const fetchSingleCityData = async (urlSuffix: string, label?: string) => {
    const API_KEY = process.env.EXPO_PUBLIC_WEATHER_API_KEY;
    if (!API_KEY) {
      throw new Error("OpenWeatherMap API anahtarı bulunamadı. Lütfen .env dosyasını kontrol edin.");
    }
    
    const currentRes = await fetch(`https://api.openweathermap.org/data/2.5/weather?${urlSuffix}&appid=${API_KEY}&units=metric&lang=tr`);
    const currentData = await currentRes.json();
    
    if (currentData.cod !== 200) {
      throw new Error(currentData.message || "Şehir bulunamadı");
    }

    const forecastRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?${urlSuffix}&appid=${API_KEY}&units=metric&lang=tr`);
    const forecastData = await forecastRes.json();
    
    let aqiIndex = 1;
    try {
      const aqiRes = await fetch(`https://api.openweathermap.org/data/2.5/air_pollution?lat=${currentData.coord.lat}&lon=${currentData.coord.lon}&appid=${API_KEY}`);
      const aqiData = await aqiRes.json();
      if(aqiData && aqiData.list && aqiData.list.length > 0) {
        aqiIndex = aqiData.list[0].main.aqi;
      }
    } catch(e) {}
    
    const aqiDetails = getAqiDetails(aqiIndex);
    const mainCondition = currentData.weather[0].main;
    
    const hourlyFull = [];
    for (let i = 0; i < Math.min(forecastData.list.length - 1, 8); i++) {
        const curr = forecastData.list[i];
        const next = forecastData.list[i + 1];
        const tempStep = (next.main.temp - curr.main.temp) / 3;
        const baseDate = new Date(curr.dt * 1000);
        
        for(let h = 0; h < 3; h++) {
            const simulatedDate = new Date(baseDate.getTime() + (h * 60 * 60 * 1000));
            hourlyFull.push({
                time: `${simulatedDate.getHours().toString().padStart(2, '0')}:00`,
                temp: Math.round(curr.main.temp + (tempStep * h)),
                icon: mapConditionToIcon(curr.weather[0].main),
                condition: curr.weather[0].main
            });
        }
    }
    const hourly = hourlyFull.slice(0, 12); 

    const dailyMap: any = {};
    forecastData.list.forEach((item: any) => {
      const dateStr = item.dt_txt.split(' ')[0];
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { 
          min: item.main.temp_min, 
          max: item.main.temp_max, 
          icon: mapConditionToIcon(item.weather[0].main), 
          condition: item.weather[0].main, 
          date: new Date(item.dt * 1000) 
        };
      } else {
        if (item.main.temp_min < dailyMap[dateStr].min) dailyMap[dateStr].min = item.main.temp_min;
        if (item.main.temp_max > dailyMap[dateStr].max) dailyMap[dateStr].max = item.main.temp_max;
      }
    });

    const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    const dailyArr = Object.values(dailyMap).slice(1, 6).map((d: any) => ({
      day: days[d.date.getDay()],
      min: Math.round(d.min),
      max: Math.round(d.max),
      icon: d.icon,
      condition: d.condition
    }));

    let baseStr = label === "KONUMUM" ? `KONUMUM (${currentData.name})` : (label || currentData.name);
    const finalName = baseStr
      .replace(/ Province/gi, '')
      .replace(/ province/gi, '')
      .replace(/ İklim/gi, '')
      .replace(/ Merkez/gi, '')
      .trim();

    return {
      id: currentData.id.toString(),
      name: finalName,
      rawName: finalName, 
      temp: Math.round(currentData.main.temp),
      condition: mainCondition,
      desc: currentData.weather[0].description.toUpperCase(),
      icon: mapConditionToIcon(mainCondition),
      max: Math.round(currentData.main.temp_max),
      min: Math.round(currentData.main.temp_min),
      feels: Math.round(currentData.main.feels_like),
      hum: currentData.main.humidity,
      windSpeed: Math.round(currentData.wind.speed * 3.6),
      windDeg: currentData.wind.deg,
      aqiIndex: aqiIndex,
      aqiText: aqiDetails.text,
      aqiColor: aqiDetails.color,
      sunrise: formatTime(currentData.sys.sunrise),
      sunset: formatTime(currentData.sys.sunset),
      hourly,
      daily: dailyArr
    };
  };

  const loadData = async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setErrorMsg(null);
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      let firstPageData;
      
      if (status === 'granted') {
        try {
          let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          firstPageData = await fetchSingleCityData(`lat=${loc.coords.latitude}&lon=${loc.coords.longitude}`, "KONUMUM");
        } catch (locErr) {
          firstPageData = await fetchSingleCityData(`q=${encodeURIComponent('İstanbul')},TR`, "KONUMUM");
        }
      } else {
        firstPageData = await fetchSingleCityData(`q=${encodeURIComponent('İstanbul')},TR`, "KONUMUM");
      }

      let pages = [firstPageData];

      const savedStr = await AsyncStorage.getItem('savedCities');
      if (savedStr) {
        const savedCities = JSON.parse(savedStr);
        for (const city of savedCities) {
          try {
            const data = await fetchSingleCityData(`q=${encodeURIComponent(city)},TR`, city.toLocaleUpperCase('tr-TR'));
            pages.push(data);
          } catch (e) {
            console.log(e);
          }
        }
      }
      setWeatherPages(pages);
    } catch (error: any) {
      setErrorMsg(error.message || 'Veri çekilirken bir hata oluştu.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handlePullToRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    loadData(true).then(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
  }, []);

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (text.length > 0) {
      const normalized = text.toLocaleLowerCase('tr-TR');
      setFilteredCities(TURKISH_CITIES.filter(city => city.toLocaleLowerCase('tr-TR').startsWith(normalized)));
      setIsDropdownVisible(true);
    } else {
      setIsDropdownVisible(false);
    }
  };

  const handleSelectCity = async (city: string) => {
    setSearchQuery('');
    setIsDropdownVisible(false);
    Keyboard.dismiss();
    setLoading(true);
    try {
      const newCityData = await fetchSingleCityData(`q=${encodeURIComponent(city)},TR`, city);
      setPreviewData(newCityData);
    } catch (e) {
      alert("Şehir bulunamadı.");
    }
    setLoading(false);
  };

  const addPreviewToList = async () => {
    const previewNormalized = previewData.name.toLocaleLowerCase('tr-TR');
    if (!weatherPages.find(p => p.name.toLocaleLowerCase('tr-TR') === previewNormalized)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const newPages = [...weatherPages, previewData];
      setWeatherPages(newPages);
      setActiveIndex(newPages.length - 1);
      
      const savedNames = newPages.slice(1).map(p => p.rawName || p.name);
      await AsyncStorage.setItem('savedCities', JSON.stringify(savedNames));
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      alert("Bu şehir zaten listenizde mevcut.");
    }
    setPreviewData(null);
  };

  const removeCity = async (indexToRemove: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newPages = weatherPages.filter((_, idx) => idx !== indexToRemove);
    setWeatherPages(newPages);
    if (activeIndex >= newPages.length) {
      setActiveIndex(Math.max(0, newPages.length - 1));
    }
    
    const savedNames = newPages.slice(1).map(p => p.rawName || p.name);
    await AsyncStorage.setItem('savedCities', JSON.stringify(savedNames));
  };

  if (loading && weatherPages.length === 0) {
    return (
      <LinearGradient colors={['#2d3436', '#1a1d1e']} style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#fff" />
      </LinearGradient>
    );
  }

  if (errorMsg && weatherPages.length === 0) {
    return (
      <LinearGradient colors={['#c0392b', '#8e44ad']} style={styles.errorContainer}>
        <Ionicons name="warning-outline" size={60} color="#fff" />
        <Text style={styles.errorTitle}>{errorMsg}</Text>
        <Text style={styles.errorSubtitle}>Lütfen terminalden sunucuyu tekrar başlatın veya internet bağlantınızı kontrol edin.</Text>
      </LinearGradient>
    );
  }

  if (previewData) {
    return (
      <LinearGradient colors={getBackgroundGradient(previewData.condition)} style={styles.previewContainer}>
        <SafeAreaView style={styles.flexOne}>
          <StatusBar barStyle="light-content" />
          <View style={styles.previewHeader}>
            <TouchableOpacity style={styles.previewBtn} onPress={() => setPreviewData(null)}>
              <Ionicons name="close" size={24} color="#fff" />
              <Text style={styles.previewBtnText}>Kapat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.previewBtn, styles.previewAddBtn]} onPress={addPreviewToList}>
              <Ionicons name="add" size={20} color="#0984e3" />
              <Text style={styles.previewAddBtnText}>Listeye Ekle</Text>
            </TouchableOpacity>
          </View>
          <WeatherScreen pageData={previewData} isPreview={true} />
        </SafeAreaView>
      </LinearGradient>
    );
  }

  const activeCondition = weatherPages[activeIndex]?.condition || 'Clear';

  return (
    <LinearGradient colors={getBackgroundGradient(activeCondition)} style={styles.container}>
      <SafeAreaView style={styles.flexOne}>
        <StatusBar barStyle="light-content" />
        
        <View style={styles.searchSection}>
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color="#fff" style={styles.searchIcon} />
            <TextInput 
              style={styles.searchInput}
              placeholder="Başka bir şehre bak..."
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={searchQuery}
              onChangeText={handleSearchChange}
            />
          </View>
          
          {isDropdownVisible && filteredCities.length > 0 && (
            <View style={styles.dropdown}>
              <ScrollView style={styles.dropdownScroll} keyboardShouldPersistTaps="handled">
                {filteredCities.map((city) => (
                  <TouchableOpacity key={city} style={styles.dropdownItem} onPress={() => handleSelectCity(city)}>
                    <Text style={styles.dropdownText}>{city}</Text>
                    <Ionicons name="chevron-forward" size={18} color="#999" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {weatherPages.length > 1 && (
          <View style={styles.paginationRow}>
            {weatherPages.map((_, i) => (
              <View key={i} style={[styles.dot, i === activeIndex ? styles.dotActive : null]} />
            ))}
          </View>
        )}

        {weatherPages.length === 0 && !loading && (
          <View style={styles.emptyContainer}>
            <Ionicons name="cloud-outline" size={80} color="rgba(255,255,255,0.5)" />
            <Text style={styles.emptyTitle}>Hava Durumu Listeniz Boş</Text>
            <Text style={styles.emptySubtitle}>Yukarıdaki arama çubuğunu kullanarak favori şehirlerinizi eklemeye başlayın.</Text>
          </View>
        )}

        {weatherPages.length > 0 && (
          <Animated.ScrollView 
            horizontal 
            pagingEnabled 
            showsHorizontalScrollIndicator={false}
            style={styles.flexOne}
            scrollEventThrottle={16}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { x: scrollX } } }],
              { useNativeDriver: true }
            )}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / width);
              if (index !== activeIndex) {
                  Haptics.selectionAsync();
                  setActiveIndex(index);
              }
            }}
          >
            {weatherPages.map((pageData, idx) => (
              <WeatherScreen 
                key={pageData.id} 
                pageData={pageData} 
                index={idx} 
                onRemove={removeCity} 
                scrollX={scrollX}
                refreshing={refreshing}
                onRefresh={handlePullToRefresh}
              />
            ))}
          </Animated.ScrollView>
        )}

        {loading && weatherPages.length > 0 && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingText}>Yükleniyor...</Text>
          </View>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flexOne: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 50 },
  centeredContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  previewContainer: { flex: 1, zIndex: 100 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  
  errorTitle: { color: '#fff', fontSize: 18, textAlign: 'center', marginTop: 20, fontWeight: '500' },
  errorSubtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', marginTop: 10 },
  emptyTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginTop: 20, textAlign: 'center' },
  emptySubtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 16, marginTop: 10, textAlign: 'center' },
  
  searchSection: { paddingHorizontal: 20, paddingTop: 10, zIndex: 50 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.4)', paddingBottom: 8, marginBottom: 15 },
  searchIcon: { marginRight: 10 },
  searchInput: { flex: 1, fontSize: 17, color: '#fff', fontWeight: '500' },
  dropdown: { position: 'absolute', top: 45, left: 20, right: 20, backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', elevation: 5 },
  dropdownScroll: { maxHeight: 180 },
  dropdownItem: { flexDirection: 'row', justifyContent: 'space-between', padding: 15, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  dropdownText: { fontSize: 16, color: '#333', fontWeight: '500' },
  
  paginationRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 4 },
  dotActive: { backgroundColor: '#fff', width: 16 },

  previewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 5 },
  previewBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.2)' },
  previewAddBtn: { backgroundColor: '#fff' },
  previewBtnText: { color: '#fff', fontSize: 15, fontWeight: '600', marginLeft: 4 },
  previewAddBtnText: { color: '#0984e3', fontSize: 15, fontWeight: 'bold', marginLeft: 4 },

  heroSection: { marginTop: 30, marginBottom: 40, alignItems: 'center' },
  heroHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', paddingHorizontal: 50, position: 'relative' },
  cityHugeText: { fontSize: 36, color: '#fff', fontWeight: '400', letterSpacing: 0.5 },
  removeButton: { position: 'absolute', right: 0, padding: 10 },
  descTextCenter: { fontSize: 20, color: 'rgba(255,255,255,0.8)', fontWeight: '500', marginTop: 5 },
  
  card: { backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 18, padding: 18, marginBottom: 15 },
  highlightCard: { backgroundColor: 'rgba(255,255,255,0.1)' },
  flexCard: { flex: 1, alignItems: 'center', padding: 16 },
  marginRightCard: { marginRight: 8 },
  marginLeftCard: { marginLeft: 8 },
  
  sectionTitle: { fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: '600', letterSpacing: 1, marginBottom: 12 },
  cardDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 15 },
  
  adviceText: { fontSize: 16, color: '#fff', fontWeight: '500', lineHeight: 24 },
  importantEventText: { fontSize: 15, color: '#fff', fontWeight: '500', lineHeight: 24 },
  
  hourlyItem: { alignItems: 'center', marginRight: 30 },
  hourlyTime: { fontSize: 15, color: '#fff', fontWeight: '500' },
  hourlyIcon: { marginVertical: 10 },
  hourlyTemp: { fontSize: 20, color: '#fff', fontWeight: '500' },
  
  dailyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  noBorderBottom: { borderBottomWidth: 0 },
  dailyDay: { color: '#fff', fontSize: 18, flex: 1, fontWeight: '500' },
  dailyIcon: { opacity: 0.9, marginRight: 15 },
  dailyTempRange: { flexDirection: 'row', alignItems: 'center', width: 130, justifyContent: 'space-between' },
  dailyMin: { color: 'rgba(255,255,255,0.6)', fontSize: 18, fontWeight: '500' },
  tempBarBackground: { height: 6, width: 60, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 3, marginHorizontal: 8, overflow: 'hidden' },
  tempBarFill: { flex: 1, borderRadius: 3 },
  dailyMax: { color: '#fff', fontSize: 18, fontWeight: '500' },
  
  rowContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
  rowContainerBottom: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  
  scoreText: { fontSize: 34, color: '#fff', fontWeight: '700', marginTop: 5 },
  scoreSubtext: { fontSize: 16, color: 'rgba(255,255,255,0.5)' },
  comfortText: { fontSize: 20, color: '#fff', fontWeight: '600', marginTop: 15, textAlign: 'center' },
  
  windContainer: { marginTop: 10, alignItems: 'center', justifyContent: 'center', height: 60 },
  windText: { fontSize: 16, color: '#fff', fontWeight: '600', marginTop: 5 },
  
  aqiText: { fontSize: 22, fontWeight: '700', marginTop: 10, textAlign: 'center' },
  aqiSubtext: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 5 },
  
  sunText: { fontSize: 26, color: '#fff', fontWeight: '500', marginTop: 10 },
  
  loadingOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  loadingText: { color: '#fff', marginTop: 10, fontWeight: '500' }
});
