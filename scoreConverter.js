const fs = require('fs');
const path = require('path');

// Load parsed point conversion rules
let rules = {};
try {
    const rulesPath = path.join(__dirname, 'parsed_rules.json');
    if (fs.existsSync(rulesPath)) {
        rules = require(rulesPath);
    } else {
        console.error('❌ Error: parsed_rules.json not found in root.');
    }
} catch (e) {
    console.error('❌ Error loading parsed_rules.json:', e.message);
}

// Map subject Vietnamese names to keys
const SUBJECT_MAP = {
    'toan': { key: 'vsat_toan', name: 'Toán' },
    'math': { key: 'vsat_toan', name: 'Toán' },
    'toán': { key: 'vsat_toan', name: 'Toán' },
    
    'vat_ly': { key: 'vsat_vat_ly', name: 'Vật lí' },
    'vat_lý': { key: 'vsat_vat_ly', name: 'Vật lí' },
    'physics': { key: 'vsat_vat_ly', name: 'Vật lí' },
    'vật lí': { key: 'vsat_vat_ly', name: 'Vật lí' },
    'vật lý': { key: 'vsat_vat_ly', name: 'Vật lí' },
    
    'hoa_hoc': { key: 'vsat_hoa_hoc', name: 'Hóa học' },
    'hoa_học': { key: 'vsat_hoa_hoc', name: 'Hóa học' },
    'chemistry': { key: 'vsat_hoa_hoc', name: 'Hóa học' },
    'hóa học': { key: 'vsat_hoa_hoc', name: 'Hóa học' },
    
    'sinh_hoc': { key: 'vsat_sinh_hoc', name: 'Sinh học' },
    'sinh_học': { key: 'vsat_sinh_hoc', name: 'Sinh học' },
    'biology': { key: 'vsat_sinh_hoc', name: 'Sinh học' },
    'sinh học': { key: 'vsat_sinh_hoc', name: 'Sinh học' },
    
    'lich_su': { key: 'vsat_lich_su', name: 'Lịch sử' },
    'lịch sử': { key: 'vsat_lich_su', name: 'Lịch sử' },
    'history': { key: 'vsat_lich_su', name: 'Lịch sử' },
    
    'dia_ly': { key: 'vsat_dia_ly', name: 'Địa lí' },
    'địa lý': { key: 'vsat_dia_ly', name: 'Địa lí' },
    'địa lí': { key: 'vsat_dia_ly', name: 'Địa lí' },
    'geography': { key: 'vsat_dia_ly', name: 'Địa lí' },
    
    'tieng_anh': { key: 'vsat_tieng_anh', name: 'Tiếng Anh' },
    'tiếng anh': { key: 'vsat_tieng_anh', name: 'Tiếng Anh' },
    'english': { key: 'vsat_tieng_anh', name: 'Tiếng Anh' },
    
    'ngu_van': { key: 'vsat_ngu_van', name: 'Ngữ văn' },
    'ngữ văn': { key: 'vsat_ngu_van', name: 'Ngữ văn' },
    'van': { key: 'vsat_ngu_van', name: 'Ngữ văn' },
    'văn': { key: 'vsat_ngu_van', name: 'Ngữ văn' },
    'literature': { key: 'vsat_ngu_van', name: 'Ngữ văn' }
};

/**
 * Linear interpolation helper
 */
function interpolate(x, rangeSrc, rangeDst) {
    const a = rangeSrc.min;
    const b = rangeSrc.max;
    const c = rangeDst.min;
    const d = rangeDst.max;
    
    // If source range is a single point, return target min
    if (b === a) return c;
    // If target range is a single point, return target min
    if (d === c) return c;
    
    return ((d - c) / (b - a)) * (x - a) + c;
}

/**
 * Matches a row in the table where value falls in the rangeSrc
 */
function matchRow(table, value, key) {
    if (!table || table.length === 0) return null;
    
    // Check edge case: if value is greater than the max possible value in table
    const maxVal = table[0][key].max;
    if (value > maxVal) {
        value = maxVal; // Clamp to max
    }
    // Check edge case: if value is less than the min possible value in table
    const minVal = table[table.length - 1][key].min;
    if (value < minVal) {
        value = minVal; // Clamp to min
    }

    for (let i = 0; i < table.length; i++) {
        const row = table[i];
        const range = row[key];
        if (!range) continue;
        
        const isLast = (i === table.length - 1);
        
        if (isLast) {
            // Last row is usually inclusive of min (e.g. 100% or > 90% row)
            if (value >= range.min && value <= range.max) {
                return { row, index: i };
            }
        } else {
            // Normal row is exclusive of min, inclusive of max (e.g. min < x <= max)
            if (value > range.min && value <= range.max) {
                return { row, index: i };
            }
        }
    }
    
    // Fallback matching
    if (value === table[0][key].max) {
        return { row: table[0], index: 0 };
    }
    return null;
}

/**
 * Convert Học bạ score to THPT scale
 * @param {number} x combined score
 * @param {string} type 'hoc_ba' or 'ket_hop'
 * @param {object} subjects optional individual subjects and scores
 * @param {string} combinationCode optional combination code (e.g. A00)
 */
function convertHocBa(x, type = 'hoc_ba', subjects = null, combinationCode = null) {
    const table = rules['hoc_ba_thpt'];
    if (!table) return { error: 'Dữ liệu bảng quy đổi Học bạ không khả dụng.' };
    
    const key = type === 'ket_hop' ? 'ket_hop' : 'hoc_ba';
    const typeLabel = type === 'ket_hop' ? 'Xét kết hợp THPT & Học bạ' : 'Xét Học bạ 3 năm THPT';
    
    const match = matchRow(table, x, key);
    if (!match) {
        return { error: `Không thể tìm thấy mốc phân vị phù hợp cho điểm ${x}.` };
    }
    
    const { row, index } = match;
    const rangeSrc = row[key];
    const rangeDst = row['thpt'];
    
    const rawConverted = interpolate(x, rangeSrc, rangeDst);
    const converted = Math.round(rawConverted * 100) / 100;
    
    // Generate explanation markdown
    let equation = '';
    if (rangeSrc.max === rangeSrc.min || rangeDst.max === rangeDst.min) {
        equation = `\`y = ${rangeDst.min}\``;
    } else {
        equation = `\`y = (${(rangeDst.max - rangeDst.min).toFixed(2)} / ${(rangeSrc.max - rangeSrc.min).toFixed(2)}) * (${x.toFixed(2)} - ${rangeSrc.min.toFixed(2)}) + ${rangeDst.min.toFixed(2)} = ${converted.toFixed(2)}\``;
    }
    
    let subjectBreakdown = '';
    if (subjects && Object.keys(subjects).length > 0) {
        const comboDisplay = combinationCode ? `tổ hợp **${combinationCode}**` : 'tổ hợp xét tuyển';
        subjectBreakdown = `Chi tiết điểm các môn trong ${comboDisplay}:\n`;
        for (const [subKey, val] of Object.entries(subjects)) {
            const subName = SUBJECT_KEY_TO_NAME[subKey] || subKey;
            subjectBreakdown += `- Môn **${subName}**: **${val.toFixed(2)}**\n`;
        }
        subjectBreakdown += `=> **Tổng điểm tổ hợp (x):** **${x.toFixed(2)}**\n\n`;
    }
    
    let explanation = `### 📝 Quy đổi điểm học bạ (${typeLabel})
${subjectBreakdown}- **Công thức tính:** ${equation}
- **Điểm sau quy đổi (thang 30):** **${converted.toFixed(2)}**`;

    // Append major recommendation and safety advisory if combinationCode is valid
    if (combinationCode && COMBINATION_MAJORS[combinationCode]) {
        explanation += `\n\n📚 **Các ngành xét tuyển tổ hợp ${combinationCode} tại CTUT bạn có thể đăng ký:**\n`;
        explanation += COMBINATION_MAJORS[combinationCode].map(m => `- ${m}`).join('\n');
        explanation += getAdvisoryReport(converted, combinationCode);
    }
    
    return {
        score: x,
        convertedScore: converted,
        moc: row.moc,
        explanation
    };
}

/**
 * Convert V-SAT subject score to THPT scale
 * @param {number} x V-SAT score (0 to 150)
 * @param {string} subject key
 */
function convertVsatSubject(x, subject) {
    const subInfo = SUBJECT_MAP[subject.toLowerCase()];
    if (!subInfo) {
        return { error: `Môn học '${subject}' không được hỗ trợ hoặc không hợp lệ.` };
    }
    
    const table = rules[subInfo.key];
    if (!table) {
        return { error: `Dữ liệu bảng quy đổi V-SAT môn ${subInfo.name} không khả dụng.` };
    }
    
    const match = matchRow(table, x, 'vsat');
    if (!match) {
        return { error: `Không thể tìm thấy mốc phân vị phù hợp cho điểm V-SAT môn ${subInfo.name}: ${x}.` };
    }
    
    const { row, index } = match;
    const rangeSrc = row['vsat'];
    const rangeDst = row['thpt'];
    
    const rawConverted = interpolate(x, rangeSrc, rangeDst);
    const converted = Math.round(rawConverted * 100) / 100;
    
    // Generate explanation markdown
    let equation = '';
    if (rangeSrc.max === rangeSrc.min || rangeDst.max === rangeDst.min) {
        equation = `\`y = ${rangeDst.min}\``;
    } else {
        equation = `\`y = (${(rangeDst.max - rangeDst.min).toFixed(2)} / ${(rangeSrc.max - rangeSrc.min).toFixed(2)}) * (${x.toFixed(2)} - ${rangeSrc.min.toFixed(2)}) + ${rangeDst.min.toFixed(2)} = ${converted.toFixed(2)}\``;
    }
    
    const explanation = `- **Môn ${subInfo.name}**: Điểm V-SAT **${x}** → Công thức: ${equation} → **${converted.toFixed(2)}**`;
    
    return {
        subjectName: subInfo.name,
        score: x,
        convertedScore: converted,
        moc: row.moc,
        explanation
    };
}

/**
 * Convert V-SAT subjects object
 * @param {object} subjectsObj keys as subjects, values as scores
 */
function convertVsat(subjectsObj) {
    const subjects = Object.keys(subjectsObj);
    if (subjects.length === 0) {
        return { error: 'Vui lòng cung cấp ít nhất một môn thi V-SAT để thực hiện quy đổi.' };
    }
    
    let totalScore = 0;
    const details = [];
    const explanations = [];
    
    for (const sub of subjects) {
        const score = parseFloat(subjectsObj[sub]);
        if (isNaN(score) || score < 0 || score > 150) {
            return { error: `Điểm thi môn ${sub} không hợp lệ (phải từ 0 đến 150).` };
        }
        
        const res = convertVsatSubject(score, sub);
        if (res.error) {
            return { error: res.error };
        }
        
        totalScore += res.convertedScore;
        details.push(res);
        explanations.push(res.explanation);
    }
    
    const roundedTotal = Math.round(totalScore * 100) / 100;
    
    let mainExplanation = `### 📝 Quy đổi điểm kỳ thi V-SAT 2026 sang thang điểm 30 THPT
Quy đổi chi tiết từng môn trong tổ hợp xét tuyển:
${explanations.join('\n')}

- **Tổng điểm quy đổi tổ hợp (thang 30):** **${roundedTotal.toFixed(2)}**`;

    // Attempt to match combination code for V-SAT subjects to recommend majors
    const combination = findCombination(subjects);
    if (combination && COMBINATION_MAJORS[combination.code]) {
        mainExplanation += `\n\n📚 **Các ngành xét tuyển tổ hợp ${combination.code} tại CTUT bạn có thể đăng ký:**\n`;
        mainExplanation += COMBINATION_MAJORS[combination.code].map(m => `- ${m}`).join('\n');
        mainExplanation += getAdvisoryReport(roundedTotal, combination.code);
    }

    return {
        subjects: details,
        totalScore: roundedTotal,
        explanation: mainExplanation
    };
}

const SUBJECT_KEY_TO_NAME = {
    toan: 'Toán',
    vat_ly: 'Vật lí',
    hoa_hoc: 'Hóa học',
    sinh_hoc: 'Sinh học',
    lich_su: 'Lịch sử',
    dia_ly: 'Địa lí',
    tieng_anh: 'Tiếng Anh',
    ngu_van: 'Ngữ văn',
    gdcd: 'GDCD&PL',
    tin_hoc: 'Tin học',
    cong_nghe: 'CNCN'
};

const COMBINATIONS = {
    'A00': ['Toán', 'Vật lí', 'Hóa học'],
    'A01': ['Toán', 'Vật lí', 'Tiếng Anh'],
    'A02': ['Toán', 'Vật lí', 'Sinh học'],
    'A03': ['Toán', 'Vật lí', 'Lịch sử'],
    'A04': ['Toán', 'Vật lí', 'Địa lí'],
    'B00': ['Toán', 'Hóa học', 'Sinh học'],
    'B03': ['Toán', 'Sinh học', 'Ngữ văn'],
    'B08': ['Toán', 'Sinh học', 'Tiếng Anh'],
    'C00': ['Ngữ văn', 'Lịch sử', 'Địa lí'],
    'C01': ['Ngữ văn', 'Toán', 'Vật lí'],
    'C02': ['Ngữ văn', 'Toán', 'Hóa học'],
    'C03': ['Ngữ văn', 'Toán', 'Lịch sử'],
    'C05': ['Ngữ văn', 'Vật lí', 'Hóa học'],
    'C08': ['Ngữ văn', 'Hóa học', 'Sinh học'],
    'D01': ['Toán', 'Ngữ văn', 'Tiếng Anh'],
    'D07': ['Toán', 'Hóa học', 'Tiếng Anh'],
    'D09': ['Toán', 'Lịch sử', 'Tiếng Anh'],
    'D10': ['Toán', 'Địa lí', 'Tiếng Anh'],
    'D11': ['Ngữ văn', 'Vật lí', 'Tiếng Anh'],
    'D12': ['Ngữ văn', 'Hóa học', 'Tiếng Anh'],
    'D13': ['Ngữ văn', 'Sinh học', 'Tiếng Anh'],
    'D14': ['Ngữ văn', 'Lịch sử', 'Tiếng Anh'],
    'D15': ['Ngữ văn', 'Địa lí', 'Tiếng Anh'],
    'X01': ['Toán', 'Ngữ văn', 'GDCD&PL'],
    'X02': ['Toán', 'Ngữ văn', 'Tin học'],
    'X05': ['Toán', 'Vật lí', 'GDCD&PL'],
    'X06': ['Toán', 'Vật lí', 'Tin học'],
    'X07': ['Toán', 'Vật lí', 'CNCN'],
    'X10': ['Toán', 'Hóa học', 'Tin học'],
    'X11': ['Toán', 'Hóa học', 'CNCN'],
    'X13': ['Toán', 'Sinh học', 'GDCD&PL'],
    'X14': ['Toán', 'Sinh học', 'Tin học'],
    'X16': ['Toán', 'Sinh học', 'CNCN'],
    'X25': ['Toán', 'Tiếng Anh', 'GDCD&PL'],
    'X26': ['Toán', 'Tiếng Anh', 'Tin học'],
    'X27': ['Toán', 'Tiếng Anh', 'CNCN'],
    'X59': ['Ngữ văn', 'Vật lí', 'Tin học'],
    'X70': ['Ngữ văn', 'Lịch sử', 'GDCD&PL'],
    'X74': ['Ngữ văn', 'Địa lí', 'GDCD&PL'],
    'X78': ['Ngữ văn', 'Tiếng Anh', 'GDCD&PL']
};

const COMBINATION_MAJORS = {
    'A00': [
        'Khoa học máy tính (7480101)', 'Khoa học dữ liệu (7460108)', 'Hệ thống thông tin (7480104)',
        'Công nghệ thông tin (7480201)', 'Kỹ thuật phần mềm (7480103)', 'Kỹ thuật hệ thống công nghiệp (7520118)',
        'Logistics và quản lý chuỗi cung ứng (7510605)', 'Quản lý công nghiệp (7510601)', 'Quản lý xây dựng (7580302)',
        'Công nghệ kỹ thuật công trình xây dựng (7510102)', 'Công nghệ kỹ thuật năng lượng (7510403)',
        'Công nghệ kỹ thuật điện, điện tử (7510301)', 'Công nghệ kỹ thuật cơ điện tử (7510203)',
        'CNKT điều khiển và tự động hóa (7510303)', 'Công nghệ kỹ thuật hóa học (7510401)', 'Công nghệ thực phẩm (7540101)',
        'Tài chính - Ngân hàng (7340201)', 'Kế toán (7340301)', 'Quản trị kinh doanh (7340101)'
    ],
    'A01': [
        'Khoa học máy tính (7480101)', 'Khoa học dữ liệu (7460108)', 'Hệ thống thông tin (7480104)',
        'Công nghệ thông tin (7480201)', 'Kỹ thuật phần mềm (7480103)', 'Kỹ thuật hệ thống công nghiệp (7520118)',
        'Logistics và quản lý chuỗi cung ứng (7510605)', 'Quản lý công nghiệp (7510601)', 'Quản lý xây dựng (7580302)',
        'Công nghệ kỹ thuật công trình xây dựng (7510102)', 'Công nghệ kỹ thuật năng lượng (7510403)',
        'Công nghệ kỹ thuật điện, điện tử (7510301)', 'Công nghệ kỹ thuật cơ điện tử (7510203)',
        'CNKT điều khiển và tự động hóa (7510303)', 'Tài chính - Ngân hàng (7340201)', 'Kế toán (7340301)',
        'Quản trị kinh doanh (7340101)'
    ],
    'A02': ['CNKT điều khiển và tự động hóa (7510303)'],
    'A03': ['CNKT điều khiển và tự động hóa (7510303)'],
    'A04': ['CNKT điều khiển và tự động hóa (7510303)'],
    'B00': ['Công nghệ kỹ thuật hóa học (7510401)', 'Công nghệ thực phẩm (7540101)', 'Công nghệ sinh học (7420201)'],
    'B03': ['Công nghệ thực phẩm (7540101)', 'Công nghệ sinh học (7420201)'],
    'B08': ['Công nghệ thực phẩm (7540101)', 'Công nghệ sinh học (7420201)'],
    'C00': ['Luật (7380101)'],
    'C01': [
        'Khoa học máy tính (7480101)', 'Khoa học dữ liệu (7460108)', 'Hệ thống thông tin (7480104)',
        'Công nghệ thông tin (7480201)', 'Kỹ thuật phần mềm (7480103)', 'Quản lý công nghiệp (7510601)',
        'Quản lý xây dựng (7580302)', 'Công nghệ kỹ thuật công trình xây dựng (7510102)',
        'Công nghệ kỹ thuật năng lượng (7510403)', 'Công nghệ kỹ thuật điện, điện tử (7510301)',
        'Công nghệ kỹ thuật cơ điện tử (7510203)', 'Tài chính - Ngân hàng (7340201)', 'Kế toán (7340301)',
        'Quản trị kinh doanh (7340101)'
    ],
    'C02': ['Quản lý xây dựng (7580302)', 'Công nghệ kỹ thuật công trình xây dựng (7510102)', 'Công nghệ kỹ thuật hóa học (7510401)', 'Công nghệ thực phẩm (7540101)'],
    'C03': ['Luật (7380101)'],
    'C05': ['Công nghệ kỹ thuật năng lượng (7510403)', 'Công nghệ kỹ thuật điện, điện tử (7510301)', 'Công nghệ kỹ thuật cơ điện tử (7510203)', 'Công nghệ kỹ thuật hóa học (7510401)'],
    'C08': ['Công nghệ kỹ thuật hóa học (7510401)', 'Công nghệ sinh học (7420201)'],
    'D01': [
        'Khoa học máy tính (7480101)', 'Khoa học dữ liệu (7460108)', 'Hệ thống thông tin (7480104)',
        'Công nghệ thông tin (7480201)', 'Kỹ thuật phần mềm (7480103)', 'Kỹ thuật hệ thống công nghiệp (7520118)',
        'Logistics và quản lý chuỗi cung ứng (7510605)', 'Quản lý công nghiệp (7510601)', 'Quản lý xây dựng (7580302)',
        'Công nghệ kỹ thuật công trình xây dựng (7510102)', 'Tài chính - Ngân hàng (7340201)', 'Kế toán (7340301)',
        'Quản trị kinh doanh (7340101)', 'Luật (7380101)', 'Ngôn ngữ Anh (7220201)'
    ],
    'D07': ['Quản lý công nghiệp (7510601)', 'Công nghệ kỹ thuật công trình xây dựng (7510102)', 'Công nghệ kỹ thuật hóa học (7510401)', 'Công nghệ thực phẩm (7540101)'],
    'D09': ['Ngôn ngữ Anh (7220201)'],
    'D10': ['Ngôn ngữ Anh (7220201)'],
    'D11': ['Ngôn ngữ Anh (7220201)'],
    'D12': ['Công nghệ kỹ thuật hóa học (7510401)'],
    'D13': ['Công nghệ sinh học (7420201)'],
    'D14': ['Luật (7380101)', 'Ngôn ngữ Anh (7220201)'],
    'D15': ['Luật (7380101)', 'Ngôn ngữ Anh (7220201)'],
    'X01': [
        'Khoa học máy tính (7480101)', 'Khoa học dữ liệu (7460108)', 'Hệ thống thông tin (7480104)',
        'Công nghệ thông tin (7480201)', 'Kỹ thuật phần mềm (7480103)', 'Quản lý công nghiệp (7510601)',
        'Quản lý xây dựng (7580302)', 'Tài chính - Ngân hàng (7340201)', 'Kế toán (7340301)',
        'Quản trị kinh doanh (7340101)'
    ],
    'X02': ['Tài chính - Ngân hàng (7340201)', 'Kế toán (7340301)', 'Quản trị kinh doanh (7340101)'],
    'X05': [
        'Khoa học máy tính (7480101)', 'Khoa học dữ liệu (7460108)', 'Hệ thống thông tin (7480104)',
        'Công nghệ thông tin (7480201)', 'Kỹ thuật phần mềm (7480103)', 'Quản lý công nghiệp (7510601)',
        'Quản lý xây dựng (7580302)', 'Công nghệ kỹ thuật công trình xây dựng (7510102)',
        'Công nghệ kỹ thuật năng lượng (7510403)', 'Công nghệ kỹ thuật điện, điện tử (7510301)',
        'Công nghệ kỹ thuật cơ điện tử (7510203)', 'CNKT điều khiển và tự động hóa (7510303)',
        'Tài chính - Ngân hàng (7340201)', 'Kế toán (7340301)', 'Quản trị kinh doanh (7340101)'
    ],
    'X06': [
        'Khoa học máy tính (7480101)', 'Khoa học dữ liệu (7460108)', 'Hệ thống thông tin (7480104)',
        'Công nghệ thông tin (7480201)', 'Kỹ thuật phần mềm (7480103)', 'Kỹ thuật hệ thống công nghiệp (7520118)',
        'Logistics và quản lý chuỗi cung ứng (7510605)', 'Quản lý xây dựng (7580302)',
        'Công nghệ kỹ thuật công trình xây dựng (7510102)', 'Công nghệ kỹ thuật năng lượng (7510403)',
        'Công nghệ kỹ thuật điện, điện tử (7510301)', 'Công nghệ kỹ thuật cơ điện tử (7510203)',
        'CNKT điều khiển và tự động hóa (7510303)'
    ],
    'X07': ['Công nghệ kỹ thuật năng lượng (7510403)', 'Công nghệ kỹ thuật điện, điện tử (7510301)', 'Công nghệ kỹ thuật cơ điện tử (7510203)', 'CNKT điều khiển và tự động hóa (7510303)'],
    'X10': ['Kỹ thuật hệ thống công nghiệp (7520118)', 'Logistics và quản lý chuỗi cung ứng (7510605)', 'Công nghệ kỹ thuật hóa học (7510401)', 'Công nghệ thực phẩm (7540101)'],
    'X11': ['Kỹ thuật hệ thống công nghiệp (7520118)', 'Logistics và quản lý chuỗi cung ứng (7510605)'],
    'X13': ['Công nghệ sinh học (7420201)'],
    'X14': ['Công nghệ thực phẩm (7540101)', 'Công nghệ sinh học (7420201)'],
    'X16': ['Công nghệ sinh học (7420201)'],
    'X25': [
        'Khoa học máy tính (7480101)', 'Khoa học dữ liệu (7460108)', 'Hệ thống thông tin (7480104)',
        'Công nghệ thông tin (7480201)', 'Kỹ thuật phần mềm (7480103)', 'Quản lý công nghiệp (7510601)',
        'Tài chính - Ngân hàng (7340201)', 'Kế toán (7340301)', 'Quản trị kinh doanh (7340101)',
        'Ngôn ngữ Anh (7220201)'
    ],
    'X26': ['Kỹ thuật hệ thống công nghiệp (7520118)', 'Logistics và quản lý chuỗi cung ứng (7510605)'],
    'X27': ['Kỹ thuật hệ thống công nghiệp (7520118)', 'Logistics và quản lý chuỗi cung ứng (7510605)'],
    'X59': ['Công nghệ kỹ thuật năng lượng (7510403)', 'Công nghệ kỹ thuật điện, điện tử (7510301)', 'Công nghệ kỹ thuật cơ điện tử (7510203)'],
    'X70': ['Luật (7380101)'],
    'X74': ['Luật (7380101)'],
    'X78': ['Luật (7380101)', 'Ngôn ngữ Anh (7220201)']
};

const BENCHMARKS_2025 = {
    'Khoa học máy tính': 22.54,
    'Khoa học dữ liệu': 21.24,
    'Hệ thống thông tin': 21.92,
    'Công nghệ thông tin': 24.23,
    'Kỹ thuật phần mềm': 22.94,
    'Kỹ thuật hệ thống công nghiệp': 20.98,
    'Logistics và quản lý chuỗi cung ứng': 23.89,
    'Quản lý công nghiệp': 22.22,
    'Quản lý xây dựng': 20.95,
    'Công nghệ kỹ thuật công trình xây dựng': 20.15,
    'Công nghệ kỹ thuật năng lượng': 21.24,
    'Công nghệ kỹ thuật điện, điện tử': 23.37,
    'Công nghệ kỹ thuật cơ điện tử': 23.37,
    'CNKT điều khiển và tự động hóa': 23.13,
    'Công nghệ kỹ thuật hóa học': 23.04,
    'Công nghệ thực phẩm': 23.26,
    'Công nghệ sinh học': 22.55,
    'Tài chính - Ngân hàng': 23.43,
    'Kế toán': 23.29,
    'Quản trị kinh doanh': 23.04,
    'Luật': 24.68,
    'Ngôn ngữ Anh': 23.74
};

function evaluateSafety(score, benchmark) {
    const diff = score - benchmark;
    if (diff >= 1.0) {
        return { rating: '🟢 Rất an toàn', desc: 'Điểm quy đổi vượt điểm chuẩn 2025 từ 1.0 điểm trở lên. Khả năng trúng tuyển cực kỳ cao.' };
    } else if (diff >= 0) {
        return { rating: '🟢 Khá an toàn', desc: 'Điểm quy đổi bằng hoặc vượt điểm chuẩn 2025 dưới 1.0 điểm. Cơ hội trúng tuyển lớn.' };
    } else if (diff >= -1.0) {
        return { rating: '🟡 Có cơ hội', desc: 'Điểm quy đổi thấp hơn điểm chuẩn 2025 dưới 1.0 điểm. Nếu điểm chuẩn năm nay giảm nhẹ, cơ hội vẫn rộng mở.' };
    } else if (diff >= -2.0) {
        return { rating: '🟠 Cạnh tranh', desc: 'Điểm quy đổi thấp hơn điểm chuẩn 2025 từ 1.0 đến 2.0 điểm. Mức độ cạnh tranh cao.' };
    } else {
        return { rating: '🔴 Khó', desc: 'Điểm quy đổi thấp hơn điểm chuẩn 2025 trên 2.0 điểm. Khả năng trúng tuyển thấp.' };
    }
}

function getAdvisoryReport(convertedScore, combinationCode) {
    if (!combinationCode || !COMBINATION_MAJORS[combinationCode]) {
        return '';
    }
    
    let report = `\n\n### 📊 Đánh giá cơ hội trúng tuyển dựa trên điểm chuẩn THPT 2025:\n`;
    const majors = COMBINATION_MAJORS[combinationCode];
    
    const ratedMajors = majors.map(major => {
        const cleanName = major.split(' (')[0].trim();
        const benchmark = BENCHMARKS_2025[cleanName];
        if (benchmark === undefined) {
            return { major, rating: '❓ Chưa có thông tin', benchmark: null, desc: 'Không tìm thấy dữ liệu điểm chuẩn tham chiếu.' };
        }
        const evalRes = evaluateSafety(convertedScore, benchmark);
        return {
            major,
            rating: evalRes.rating,
            desc: evalRes.desc,
            benchmark
        };
    });
    
    // Sort ratedMajors: safety level from safest to hardest
    const order = {
        '🟢 Rất an toàn': 1,
        '🟢 Khá an toàn': 2,
        '🟡 Có cơ hội': 3,
        '🟠 Cạnh tranh': 4,
        '🔴 Khó': 5,
        '❓ Chưa có thông tin': 6
    };
    
    ratedMajors.sort((a, b) => order[a.rating] - order[b.rating]);
    
    ratedMajors.forEach(item => {
        const benchmarkStr = item.benchmark !== null ? `(Điểm chuẩn 2025: **${item.benchmark.toFixed(2)}**)` : '';
        report += `- Ngành **${item.major}**: ${item.rating} ${benchmarkStr}\n  *${item.desc}*\n`;
    });
    
    return report;
}

function findCombination(subjectKeys) {
    const targetNames = subjectKeys.map(k => SUBJECT_KEY_TO_NAME[k]).filter(Boolean);
    if (targetNames.length !== 3) return null;
    
    for (const [code, subjects] of Object.entries(COMBINATIONS)) {
        const matchAll = subjects.every(s => targetNames.includes(s)) && targetNames.every(s => subjects.includes(s));
        if (matchAll) {
            return { code, subjects };
        }
    }
    return null;
}

module.exports = {
    convertHocBa,
    convertVsatSubject,
    convertVsat,
    SUBJECT_MAP,
    SUBJECT_KEY_TO_NAME,
    findCombination
};
